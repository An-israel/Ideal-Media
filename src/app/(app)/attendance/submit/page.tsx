import { notFound } from "next/navigation";
import { getSessionRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSubunitRoster, getRecordsFor } from "@/lib/attendance-queries";
import { deadlineFor, formatWAT, isLate, hasOccurred } from "@/lib/attendance-window";
import { formatReportDate } from "@/lib/attendance-report";
import { PageHeader } from "@/components/app/page-header";
import { SubmitForm, type FormMember } from "./submit-form";

export default async function SubmitAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ subunit?: string; activity?: string; date?: string }>;
}) {
  const { subunit, activity, date } = await searchParams;
  if (!subunit || !activity || !date) notFound();
  // Any past date is fair game — reporting is weekly and a missed week must
  // stay fileable — but a service still to come has nothing to report.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !hasOccurred(date)) notFound();

  const session = await getSessionRoles();
  if (!session) return null;

  const privileged =
    session.roles.includes("super_admin") ||
    session.roles.includes("secretary") ||
    session.roles.includes("welfare");
  if (!privileged && !session.ledSubunitIds.includes(subunit)) notFound();

  const admin = createAdminClient();
  const [{ data: subunitRow }, { data: activityRow }, roster] = await Promise.all([
    admin.from("subunits").select("id, name").eq("id", subunit).maybeSingle(),
    admin.from("activities").select("id, name").eq("id", activity).maybeSingle(),
    getSubunitRoster([subunit]),
  ]);
  if (!subunitRow || !activityRow) notFound();

  const existing = await getRecordsFor(activity, date, roster.map((r) => r.userId));
  const { data: submission } = await admin
    .from("attendance_submissions")
    .select("is_late, no_service, no_service_reason, submitted_at")
    .eq("subunit_id", subunit)
    .eq("activity_id", activity)
    .eq("service_date", date)
    .maybeSingle();

  const members: FormMember[] = roster.map((r) => {
    const rec = existing.get(r.userId);
    return {
      userId: r.userId,
      fullName: r.fullName,
      memberStatus: r.memberStatus,
      // A member marked traveled on the roster is pre-filled as traveled rather
      // than hidden, so they still count and the leader only confirms.
      status: rec?.status ?? (r.memberStatus === "traveled" ? "traveled" : "present"),
      absenceReason:
        rec?.absenceReason ?? (r.memberStatus === "traveled" ? "travelled" : null),
      absenceNote: rec?.absenceNote ?? null,
    };
  });

  const overdue = isLate(date);
  const lockedToLeader = overdue && !!submission && !privileged;

  return (
    <div>
      <PageHeader
        title={`${subunitRow.name} — ${activityRow.name}`}
        description={`${formatReportDate(date)} · due ${formatWAT(deadlineFor(date))} WAT`}
      />
      <SubmitForm
        subunitId={subunit}
        activityId={activity}
        serviceDate={date}
        members={members}
        alreadySubmitted={!!submission}
        noService={submission?.no_service ?? false}
        noServiceReason={submission?.no_service_reason ?? ""}
        overdue={overdue}
        locked={lockedToLeader}
      />
    </div>
  );
}
