import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyRole } from "@/lib/notify";
import { fetchAllRows } from "@/lib/pagination";
import { DEFAULT_MISSED_SERVICE_THRESHOLD, MAX_WELFARE_LEVEL } from "@/lib/constants";

/**
 * Reads the missed-service threshold, clamped to a sane value (AUDIT WEL-1).
 *
 * `setMissedThreshold` accepted any number. At 0 the old code was catastrophic:
 * `recentDates` became `[]`, `[].every(...)` is `true` by definition, and so
 * EVERY active member was flagged on the next attendance commit.
 */
export async function getMissedThreshold(
  admin: ReturnType<typeof createAdminClient>
): Promise<number> {
  const { data: setting } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "missed_service_threshold")
    .maybeSingle();

  const raw = Number(setting?.value ?? DEFAULT_MISSED_SERVICE_THRESHOLD);
  if (!Number.isFinite(raw)) return DEFAULT_MISSED_SERVICE_THRESHOLD;
  return Math.max(1, Math.min(52, Math.floor(raw)));
}

/** Every activity flagged as an attendance signal. */
export async function getSignalActivityIds(
  admin: ReturnType<typeof createAdminClient>
): Promise<string[]> {
  const { data } = await admin
    .from("activities")
    .select("id")
    .eq("is_attendance_signal", true)
    .order("created_at", { ascending: true });
  return (data ?? []).map((a) => a.id);
}

/**
 * After a signal-activity attendance commit, opens or escalates missed-service
 * welfare followups for active members absent for >= threshold consecutive
 * sessions of that activity (Section 10). `traveled`/`excused` break the missed
 * streak; never opens a duplicate when one is already open.
 *
 * Escalation is real now (AUDIT WEL-3): the level tracks how many thresholds
 * deep the absence runs, capped at 3. Previously every followup was inserted at
 * level 1 and nothing ever raised it, so the 3-tier model in the schema and the
 * UI was never driven by the data.
 *
 * The welfare team is notified about new flags and escalations (AUDIT WEL-5) —
 * this is the highest-volume automatic trigger and it used to notify nobody.
 */
export async function recomputeMissedService(activityId: string) {
  const admin = createAdminClient();
  const threshold = await getMissedThreshold(admin);

  // Distinct service dates for this activity, newest first. Enough history to
  // measure escalation up to the top level.
  const historyDepth = threshold * MAX_WELFARE_LEVEL;
  const { data: dateRows } = await admin
    .from("attendance_records")
    .select("service_date")
    .eq("activity_id", activityId)
    .order("service_date", { ascending: false })
    .limit(5000);

  const recentDates = [...new Set((dateRows ?? []).map((r) => r.service_date))].slice(
    0,
    historyDepth
  );
  if (recentDates.length < threshold) return; // not enough history yet

  const [activeMembers, records, openFollowups] = await Promise.all([
    // Paged: an unbounded select caps at 1000 rows, so past 1000 members the
    // rest were never considered for flagging (AUDIT PERF-2).
    fetchAllRows<{ id: string }>((from, to) =>
      admin.from("profiles").select("id").eq("member_status", "active").range(from, to)
    ),
    fetchAllRows<{ user_id: string; service_date: string; status: string }>((from, to) =>
      admin
        .from("attendance_records")
        .select("user_id, service_date, status")
        .eq("activity_id", activityId)
        .in("service_date", recentDates)
        .range(from, to)
    ),
    fetchAllRows<{ id: string; user_id: string; level: number }>((from, to) =>
      admin
        .from("welfare_followups")
        .select("id, user_id, level")
        .eq("reason", "missed_service")
        .neq("status", "resolved")
        .range(from, to)
    ),
  ]);

  // user_id → { date → status }
  const byUser = new Map<string, Map<string, string>>();
  for (const r of records) {
    const m = byUser.get(r.user_id) ?? new Map<string, string>();
    m.set(r.service_date, r.status);
    byUser.set(r.user_id, m);
  }
  const openByUser = new Map(openFollowups.map((f) => [f.user_id, f]));

  const toFlag: { user_id: string; level: number }[] = [];
  const toEscalate: { id: string; user_id: string; level: number }[] = [];

  for (const member of activeMembers) {
    const statuses = byUser.get(member.id);
    if (!statuses) continue;

    // Count the trailing run of explicit absences. A 'traveled'/'excused'
    // record breaks the streak; a date with no record at all is unknown rather
    // than a miss, so it also stops the count.
    let missed = 0;
    for (const d of recentDates) {
      if (statuses.get(d) === "absent") missed++;
      else break;
    }
    if (missed < threshold) continue;

    const level = Math.max(1, Math.min(MAX_WELFARE_LEVEL, Math.floor(missed / threshold)));
    const open = openByUser.get(member.id);

    if (!open) {
      toFlag.push({ user_id: member.id, level });
    } else if (level > open.level) {
      toEscalate.push({ id: open.id, user_id: member.id, level });
    }
  }

  if (toFlag.length === 0 && toEscalate.length === 0) return;

  if (toFlag.length) {
    const { error } = await admin.from("welfare_followups").insert(
      toFlag.map((f) => ({
        user_id: f.user_id,
        reason: "missed_service" as const,
        level: f.level,
        auto_flagged: true,
      }))
    );
    if (error) {
      console.error("[welfare] could not open missed-service followups:", error.message);
      return;
    }
  }

  for (const e of toEscalate) {
    const { error } = await admin
      .from("welfare_followups")
      .update({ level: e.level })
      .eq("id", e.id);
    if (error) console.error(`[welfare] could not escalate followup ${e.id}:`, error.message);
  }

  // Tell the welfare team who needs attention.
  const affectedIds = [...toFlag.map((f) => f.user_id), ...toEscalate.map((e) => e.user_id)];
  const { data: profs } = await admin
    .from("profiles")
    .select("id, full_name")
    .in("id", affectedIds);
  const names = (profs ?? []).map((p) => p.full_name);
  const shown = names.slice(0, 5).join(", ");
  const more = names.length > 5 ? ` and ${names.length - 5} more` : "";

  const parts: string[] = [];
  if (toFlag.length) parts.push(`${toFlag.length} newly flagged`);
  if (toEscalate.length) parts.push(`${toEscalate.length} escalated`);

  await notifyRole("welfare", {
    type: "missed_service_flagged",
    title:
      names.length === 1
        ? `${names[0]} has missed ${threshold}+ services`
        : `${names.length} members need a follow-up`,
    body: `${parts.join(", ")}. Please follow up: ${shown}${more}.`,
    link: "/welfare",
  });
}

/**
 * Resolves auto-opened followups for members who no longer need one — someone
 * back to 'active', or who has graduated/left (AUDIT WEL-7).
 */
export async function resolveAutoFollowups(
  userIds: string[],
  reasons: ("traveled" | "inactive" | "missed_service")[]
) {
  if (userIds.length === 0) return;
  const admin = createAdminClient();
  const { error } = await admin
    .from("welfare_followups")
    .update({ status: "resolved" })
    .in("user_id", userIds)
    .in("reason", reasons)
    .eq("auto_flagged", true)
    .neq("status", "resolved");
  if (error) console.error("[welfare] could not resolve followups:", error.message);
}
