import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/pagination";
import { buildReport, type ReportPerson, type SubunitBreakdownRow } from "@/lib/attendance-report";
import type { AbsenceReason, AttendanceStatus } from "@/lib/database.types";

export interface RosterPerson {
  userId: string;
  fullName: string;
  subunitId: string;
  subunitName: string;
  memberStatus: string;
}

/**
 * Everyone a subunit reports on: its PRIMARY members only.
 *
 * A person can sit in up to four subunits but is reported by exactly one, so
 * the department total is the sum of the subunits with nobody counted twice.
 *
 * Graduated and left members are off the roll entirely. Traveled members stay
 * on it — they are pre-marked rather than hidden, so they never silently drop
 * out of the percentages.
 */
export async function getSubunitRoster(subunitIds: string[]): Promise<RosterPerson[]> {
  if (subunitIds.length === 0) return [];
  const admin = createAdminClient();

  type Row = {
    user_id: string;
    subunit_id: string;
    profiles: { full_name: string; member_status: string } | null;
    subunits: { name: string } | null;
  };

  const rows = await fetchAllRows<Row>((from, to) =>
    admin
      .from("subunit_members")
      .select("user_id, subunit_id, profiles(full_name, member_status), subunits(name)")
      .eq("membership_type", "primary")
      .in("subunit_id", subunitIds)
      .range(from, to) as unknown as PromiseLike<{
      data: Row[] | null;
      error: { message: string } | null;
    }>
  );

  return rows
    .filter((r) => r.profiles && !["graduated", "left"].includes(r.profiles.member_status))
    .map((r) => ({
      userId: r.user_id,
      fullName: r.profiles!.full_name,
      subunitId: r.subunit_id,
      subunitName: r.subunits?.name ?? "—",
      memberStatus: r.profiles!.member_status,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/** The whole department's roll, for the paste flow and the report. */
export async function getDepartmentRoster(): Promise<RosterPerson[]> {
  const admin = createAdminClient();
  const { data: subunits } = await admin.from("subunits").select("id");
  return getSubunitRoster((subunits ?? []).map((s) => s.id));
}

export interface ExistingRecord {
  userId: string;
  status: AttendanceStatus;
  absenceReason: AbsenceReason | null;
  absenceNote: string | null;
}

export async function getRecordsFor(
  activityId: string,
  serviceDate: string,
  userIds?: string[]
): Promise<Map<string, ExistingRecord>> {
  const admin = createAdminClient();
  const rows = await fetchAllRows<{
    user_id: string;
    status: AttendanceStatus;
    absence_reason: AbsenceReason | null;
    absence_note: string | null;
  }>((from, to) => {
    let q = admin
      .from("attendance_records")
      .select("user_id, status, absence_reason, absence_note")
      .eq("activity_id", activityId)
      .eq("service_date", serviceDate);
    if (userIds && userIds.length > 0) q = q.in("user_id", userIds);
    return q.range(from, to);
  });

  return new Map(
    rows.map((r) => [
      r.user_id,
      {
        userId: r.user_id,
        status: r.status,
        absenceReason: r.absence_reason,
        absenceNote: r.absence_note,
      },
    ])
  );
}

export interface SubmissionRow {
  subunitId: string;
  submittedBy: string | null;
  submittedAt: string;
  isLate: boolean;
  noService: boolean;
  noServiceReason: string | null;
  presentCount: number;
  absentCount: number;
}

export async function getSubmissions(
  activityId: string,
  serviceDate: string
): Promise<Map<string, SubmissionRow>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("attendance_submissions")
    .select(
      "subunit_id, submitted_by, submitted_at, is_late, no_service, no_service_reason, present_count, absent_count"
    )
    .eq("activity_id", activityId)
    .eq("service_date", serviceDate);

  return new Map(
    (data ?? []).map((s) => [
      s.subunit_id,
      {
        subunitId: s.subunit_id,
        submittedBy: s.submitted_by,
        submittedAt: s.submitted_at,
        isLate: s.is_late,
        noService: s.no_service,
        noServiceReason: s.no_service_reason,
        presentCount: s.present_count,
        absentCount: s.absent_count,
      },
    ])
  );
}

/** Assembles everything the department report needs for one service. */
export async function getReportData(activityId: string, serviceDate: string) {
  const admin = createAdminClient();
  const [{ data: activity }, roster] = await Promise.all([
    admin.from("activities").select("name").eq("id", activityId).maybeSingle(),
    getDepartmentRoster(),
  ]);

  const [records, submissions, { data: subunitRows }] = await Promise.all([
    getRecordsFor(activityId, serviceDate),
    getSubmissions(activityId, serviceDate),
    admin.from("subunits").select("id, name").order("name"),
  ]);

  const people: ReportPerson[] = roster.map((p) => {
    const rec = records.get(p.userId);
    return {
      userId: p.userId,
      fullName: p.fullName,
      subunitName: p.subunitName,
      // No record yet means nobody has reported on this person. Counting them
      // present would invent attendance, so they count as absent with no
      // category — which is also what makes the "not submitted" list matter.
      status: rec?.status ?? "absent",
      absenceReason: rec?.absenceReason ?? null,
      absenceNote: rec?.absenceNote ?? null,
    };
  });

  const bySubunit = new Map<string, RosterPerson[]>();
  for (const p of roster) {
    bySubunit.set(p.subunitId, [...(bySubunit.get(p.subunitId) ?? []), p]);
  }

  const subunits: SubunitBreakdownRow[] = (subunitRows ?? []).map((s) => {
    const members = bySubunit.get(s.id) ?? [];
    const sub = submissions.get(s.id);
    const present = members.filter((m) => records.get(m.userId)?.status === "present").length;
    return {
      subunitName: s.name,
      total: members.length,
      present,
      absent: members.length - present,
      submitted: !!sub && !sub.noService,
      late: sub?.isLate ?? false,
      noService: sub?.noService ?? false,
    };
  });

  return buildReport({
    activityName: activity?.name ?? "Service",
    serviceDate,
    people,
    subunits: subunits.filter((s) => s.total > 0),
  });
}

/** The two services currently open, with their activity ids. */
export async function getServiceActivities() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("activities")
    .select("id, name, day_of_week")
    .in("name", ["Sunday Service", "Bible Study"]);
  const byName = new Map((data ?? []).map((a) => [a.name, a]));
  return {
    sunday: byName.get("Sunday Service") ?? null,
    bibleStudy: byName.get("Bible Study") ?? null,
  };
}
