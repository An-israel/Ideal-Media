import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_MISSED_SERVICE_THRESHOLD } from "@/lib/constants";

/**
 * After a signal-activity attendance commit, opens missed-service welfare
 * followups for active members absent for >= threshold consecutive sessions of
 * that activity (Section 10). `traveled`/`excused` break the missed streak;
 * never opens a duplicate when one is already open. Uses the admin client.
 */
export async function recomputeMissedService(activityId: string) {
  const admin = createAdminClient();

  // Configurable threshold (super admin can change it).
  const { data: setting } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "missed_service_threshold")
    .maybeSingle();
  const threshold = Number(setting?.value ?? DEFAULT_MISSED_SERVICE_THRESHOLD);

  // The most recent `threshold` distinct service dates for this activity.
  const { data: dateRows } = await admin
    .from("attendance_records")
    .select("service_date")
    .eq("activity_id", activityId)
    .order("service_date", { ascending: false });

  const recentDates = [...new Set((dateRows ?? []).map((r) => r.service_date))].slice(
    0,
    threshold
  );
  if (recentDates.length < threshold) return; // not enough history yet

  const [{ data: activeMembers }, { data: records }, { data: openFollowups }] =
    await Promise.all([
      admin.from("profiles").select("id").eq("member_status", "active"),
      admin
        .from("attendance_records")
        .select("user_id, service_date, status")
        .eq("activity_id", activityId)
        .in("service_date", recentDates),
      admin
        .from("welfare_followups")
        .select("user_id")
        .eq("reason", "missed_service")
        .neq("status", "resolved"),
    ]);

  // user_id → { date → status }
  const byUser = new Map<string, Map<string, string>>();
  for (const r of records ?? []) {
    const m = byUser.get(r.user_id) ?? new Map<string, string>();
    m.set(r.service_date, r.status);
    byUser.set(r.user_id, m);
  }
  const alreadyOpen = new Set((openFollowups ?? []).map((f) => f.user_id));

  const toFlag: string[] = [];
  for (const member of activeMembers ?? []) {
    if (alreadyOpen.has(member.id)) continue;
    const statuses = byUser.get(member.id);
    // Missed = explicitly absent on every one of the recent dates.
    const missedAll = recentDates.every((d) => statuses?.get(d) === "absent");
    if (missedAll) toFlag.push(member.id);
  }

  if (toFlag.length) {
    await admin.from("welfare_followups").insert(
      toFlag.map((user_id) => ({
        user_id,
        reason: "missed_service" as const,
        auto_flagged: true,
      }))
    );
  }
}
