import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyMany } from "@/lib/notify";
import { fetchAllRows } from "@/lib/pagination";
import {
  openServiceDates,
  deadlineFor,
  morningReminderFor,
  finalReminderFor,
  formatWAT,
} from "@/lib/attendance-window";
import { formatReportDate } from "@/lib/attendance-report";
import { sendEmails, type EmailResult } from "@/lib/email";

/** Room for the emails, which are paced to stay inside the provider's rate limit. */
export const maxDuration = 60;

/**
 * Nudges leaders who still owe an attendance report.
 *
 * Runs once a day at 18:00 WAT (see vercel.json — the Hobby plan allows no
 * more), which is two hours before the 8PM deadline, so in practice it sends
 * the final reminder for whichever service is due that evening. The morning
 * window is kept for a plan that can run it more often. Only leaders of
 * primary subunits with nothing recorded are notified, so nobody is nagged
 * after they have done their part.
 *
 * Authenticates itself for the same reason as the birthday route: /api is
 * excluded from the session proxy, so this request carries no Supabase session.
 * A missing CRON_SECRET fails CLOSED — an open endpoint here would let anyone
 * notify every leader in the department at will.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/attendance-reminders] CRON_SECRET is not set — refusing to run.");
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured on this deployment." },
      { status: 503 }
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const dates = openServiceDates(now);

  const { data: activities } = await admin
    .from("activities")
    .select("id, name")
    .in("name", ["Sunday Service", "Bible Study"]);

  const services = (activities ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    date: a.name === "Sunday Service" ? dates.sunday : dates.wednesday,
  }));

  const sent: { service: string; kind: string; leaders: number; email: EmailResult }[] = [];
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

  for (const service of services) {
    // Which window are we in? Each reminder fires in the hour that follows its
    // moment, because the cron runs hourly rather than continuously.
    const kind = dueKind(now, service.date);
    if (!kind) continue;

    // Once per service per window, tracked in app_settings so an hourly cron
    // that overlaps a window boundary can't send twice.
    const markerKey = `attendance_reminder:${service.id}:${service.date}:${kind}`;
    const { data: marker } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", markerKey)
      .maybeSingle();
    if (marker) continue;

    // Primary units only. Secondary units (Video Editing, Graphic Design,
    // Welfare, Secretary, Publication) never file attendance — their members
    // are counted by their primary unit — so they are permanently "not
    // submitted", and reading every subunit here nagged their leaders about a
    // report that does not exist, twice a week, for ever.
    const { data: subunits } = await admin
      .from("subunits")
      .select("id, name")
      .eq("category", "primary");
    const { data: submitted } = await admin
      .from("attendance_submissions")
      .select("subunit_id")
      .eq("activity_id", service.id)
      .eq("service_date", service.date);
    const done = new Set((submitted ?? []).map((s) => s.subunit_id));
    const outstanding = (subunits ?? []).filter((s) => !done.has(s.id));
    if (outstanding.length === 0) continue;

    // Leaders of the subunits that still owe a report.
    const leaders = await fetchAllRows<{ user_id: string; subunit_id: string }>((from, to) =>
      admin
        .from("subunit_members")
        .select("user_id, subunit_id")
        .eq("role_in_subunit", "leader")
        .in("subunit_id", outstanding.map((s) => s.id))
        .range(from, to)
    );

    // Not a leader who has left or had their access removed: the notification
    // would sit unread on an account nobody opens, and the count below would
    // claim somebody had been reminded.
    const leaderIds = [...new Set(leaders.map((l) => l.user_id))];
    const reachable =
      leaderIds.length > 0
        ? await fetchAllRows<{
            id: string;
            member_status: string;
            email: string;
            full_name: string;
          }>((from, to) =>
            admin
              .from("profiles")
              .select("id, member_status, email, full_name")
              .in("id", leaderIds)
              .is("access_revoked_at", null)
              .range(from, to)
          )
        : [];
    const people = reachable.filter((p) => !["left", "graduated"].includes(p.member_status));
    const recipients = people.map((p) => p.id);
    let email: EmailResult = { configured: false, sent: 0, failed: 0 };
    if (recipients.length > 0) {
      const deadline = formatWAT(deadlineFor(service.date));
      await notifyMany(
        recipients.map((userId) => ({
          userId,
          type: "attendance_due",
          title:
            kind === "morning"
              ? `${service.name} attendance is due today`
              : `${service.name} attendance is due in 2 hours`,
          body: `Report for ${formatReportDate(service.date)} by ${deadline} WAT.`,
          link: "/attendance",
        }))
      );

      // The same reminder by email, for the leader who has not opened the app
      // — which is the one it is for. Sent after the notification and never
      // awaited for success: sendEmails reports failures instead of throwing.
      const unitsOf = new Map<string, string[]>();
      for (const l of leaders) {
        const name = outstanding.find((s) => s.id === l.subunit_id)?.name;
        if (name) unitsOf.set(l.user_id, [...(unitsOf.get(l.user_id) ?? []), name]);
      }
      email = await sendEmails(
        people.map((p) => {
          const units = unitsOf.get(p.id) ?? [];
          return {
            to: p.email,
            subject:
              kind === "morning"
                ? `${service.name} attendance is due today`
                : `${service.name} attendance is due in 2 hours`,
            text: [
              `Hi ${p.full_name.split(" ")[0]},`,
              "",
              `The ${service.name} attendance for ${formatReportDate(service.date)} has not been submitted yet${
                units.length ? ` for ${units.join(" and ")}` : ""
              }.`,
              `It is due by ${deadline} WAT.`,
              "",
              appUrl ? `Submit it here: ${appUrl}/attendance` : "Open the Ideal Media site and go to Attendance.",
              "",
              "After the deadline it can still be submitted, but it is marked late.",
              "",
              "— Ideal Media",
            ].join("\n"),
          };
        })
      );
    }

    await admin
      .from("app_settings")
      .upsert({ key: markerKey, value: JSON.stringify(now.toISOString()) }, { onConflict: "key" });

    sent.push({
      service: `${service.name} ${service.date}`,
      kind,
      leaders: recipients.length,
      email,
    });
  }

  return NextResponse.json({ ok: true, sent });
}

/**
 * Which reminder, if any, belongs to the hour we are in.
 *
 * Returns null outside both windows and after the deadline — a late report is
 * chased by the report page's "not submitted" list, not by more notifications.
 */
function dueKind(now: Date, serviceDate: string): "morning" | "final" | null {
  const t = now.getTime();
  const morning = morningReminderFor(serviceDate).getTime();
  const final = finalReminderFor(serviceDate).getTime();
  const deadline = deadlineFor(serviceDate).getTime();
  // Each window runs until the next thing happens, not for exactly one hour.
  // Vercel starts a daily cron "sometime within the hour", and a run that
  // began a few seconds past a one-hour window sent nothing at all that day.
  // The marker row is what stops a repeat, so a wide window costs nothing.
  if (t >= final && t < deadline) return "final";
  if (t >= morning && t < final) return "morning";
  return null;
}
