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

/**
 * Nudges leaders who still owe an attendance report.
 *
 * Fires hourly (see vercel.json) and sends at most two reminders per service:
 * one on the morning the report is due, one two hours before the 8PM WAT
 * deadline. Only leaders of subunits with nothing recorded are notified, so
 * nobody is nagged after they have done their part.
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

  const sent: { service: string; kind: string; leaders: number }[] = [];

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

    const { data: subunits } = await admin.from("subunits").select("id, name");
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

    const recipients = [...new Set(leaders.map((l) => l.user_id))];
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
    }

    await admin
      .from("app_settings")
      .upsert({ key: markerKey, value: JSON.stringify(now.toISOString()) }, { onConflict: "key" });

    sent.push({ service: `${service.name} ${service.date}`, kind, leaders: recipients.length });
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
  const hour = 3600_000;
  const morning = morningReminderFor(serviceDate).getTime();
  const final = finalReminderFor(serviceDate).getTime();
  if (t >= morning && t < morning + hour) return "morning";
  if (t >= final && t < final + hour) return "final";
  return null;
}
