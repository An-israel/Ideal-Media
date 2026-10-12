import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/pagination";
import { resolveReportingSubunits } from "@/lib/reporting-subunit";
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
 * Member rows, tolerating a database that has not run migration 0015 yet.
 *
 * Selecting a column that does not exist makes PostgREST reject the whole
 * query, which would empty every attendance list rather than degrade. So the
 * revoked column is asked for, and dropped on a retry if it is not there.
 */
async function loadMemberRows(
  admin: ReturnType<typeof createAdminClient>,
  userIds?: string[]
): Promise<{ id: string; full_name: string; member_status: string; access_revoked_at: string | null }[]> {
  type Row = {
    id: string;
    full_name: string;
    member_status: string;
    access_revoked_at?: string | null;
  };
  const read = (columns: string) =>
    fetchAllRows<Row>((from, to) => {
      let q = admin.from("profiles").select(columns);
      if (userIds) q = q.in("id", userIds);
      return q.range(from, to) as unknown as PromiseLike<{
        data: Row[] | null;
        error: { message: string } | null;
      }>;
    });

  try {
    const rows = await read("id, full_name, member_status, access_revoked_at");
    return rows.map((r) => ({ ...r, access_revoked_at: r.access_revoked_at ?? null }));
  } catch {
    const rows = await read("id, full_name, member_status");
    return rows.map((r) => ({ ...r, access_revoked_at: null }));
  }
}

/**
 * Everyone a subunit reports on.
 *
 * Membership alone does not decide this — resolveReportingSubunit() does, so
 * that each person lands on exactly one list. In practice that means a
 * subunit's primary members, plus any leader of it who has no primary subunit
 * of their own (promoting someone to lead a subunit they weren't in adds them
 * as a *secondary* member, which used to leave them missing from the very list
 * they had to fill in).
 *
 * Graduated and left members are off the roll entirely. Traveled members stay
 * on it — they are pre-marked rather than hidden, so they never silently drop
 * out of the percentages.
 */
export async function getSubunitRoster(subunitIds: string[]): Promise<RosterPerson[]> {
  if (subunitIds.length === 0) return [];
  const admin = createAdminClient();

  type MemberRow = {
    user_id: string;
    subunit_id: string;
    membership_type: "primary" | "secondary";
    role_in_subunit: "member" | "leader";
  };

  // Anyone attached to one of these subunits in any capacity is a candidate.
  const candidates = await fetchAllRows<{ user_id: string }>((from, to) =>
    admin.from("subunit_members").select("user_id").in("subunit_id", subunitIds).range(from, to)
  );
  const candidateIds = [...new Set(candidates.map((c) => c.user_id))];
  if (candidateIds.length === 0) return [];

  // Their memberships EVERYWHERE, because where a person is reported depends on
  // whether they hold a primary membership in some other subunit.
  const memberships = await fetchAllRows<MemberRow>((from, to) =>
    admin
      .from("subunit_members")
      .select("user_id, subunit_id, membership_type, role_in_subunit")
      .in("user_id", candidateIds)
      .range(from, to)
  );

  const reporting = resolveReportingSubunits(
    memberships.map((m) => ({
      userId: m.user_id,
      subunitId: m.subunit_id,
      membershipType: m.membership_type,
      roleInSubunit: m.role_in_subunit,
    }))
  );

  const wanted = new Set(subunitIds);
  const userIds = candidateIds.filter((id) => {
    const s = reporting.get(id);
    return s !== undefined && wanted.has(s);
  });
  if (userIds.length === 0) return [];

  const [profiles, { data: subunitRows }] = await Promise.all([
    loadMemberRows(admin, userIds),
    admin.from("subunits").select("id, name"),
  ]);
  const subunitName = new Map((subunitRows ?? []).map((s) => [s.id, s.name]));

  return profiles
    .filter((p) => !["graduated", "left"].includes(p.member_status) && p.access_revoked_at === null)
    .map((p) => {
      const subunitId = reporting.get(p.id)!;
      return {
        userId: p.id,
        fullName: p.full_name,
        subunitId,
        subunitName: subunitName.get(subunitId) ?? "\u2014",
        memberStatus: p.member_status,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/**
 * People on the roll that no subunit reports on — no primary membership and no
 * leadership anywhere. They are invisible to attendance until somebody sets
 * their primary subunit, so the report names them rather than losing them.
 */
export async function getUnassignedMembers(): Promise<{ userId: string; fullName: string }[]> {
  const admin = createAdminClient();
  const [profiles, memberships] = await Promise.all([
    loadMemberRows(admin),
    fetchAllRows<{
      user_id: string;
      subunit_id: string;
      membership_type: "primary" | "secondary";
      role_in_subunit: "member" | "leader";
    }>((from, to) =>
      admin
        .from("subunit_members")
        .select("user_id, subunit_id, membership_type, role_in_subunit")
        .range(from, to)
    ),
  ]);

  const reporting = resolveReportingSubunits(
    memberships.map((m) => ({
      userId: m.user_id,
      subunitId: m.subunit_id,
      membershipType: m.membership_type,
      roleInSubunit: m.role_in_subunit,
    }))
  );

  return profiles
    .filter((p) => !["graduated", "left"].includes(p.member_status) && p.access_revoked_at === null)
    .filter((p) => !reporting.has(p.id))
    .map((p) => ({ userId: p.id, fullName: p.full_name }))
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

  // Anyone who has a record for this service but is no longer on the roll —
  // they have since left the unit and had their access revoked.
  //
  // Without this, revoking two members would retroactively turn a report that
  // read "Total Members: 101" into 99 and drop those names out of their
  // categories, changing numbers that had already been sent to the Pastors. A
  // report for a past service has to show who was on the roll THEN.
  const onRoll = new Set(roster.map((p) => p.userId));
  const departedIds = [...records.keys()].filter((id) => !onRoll.has(id));
  if (departedIds.length > 0) {
    const departed = await fetchAllRows<{ id: string; full_name: string }>((from, to) =>
      admin.from("profiles").select("id, full_name").in("id", departedIds).range(from, to)
    );
    for (const d of departed) {
      const rec = records.get(d.id)!;
      people.push({
        userId: d.id,
        fullName: d.full_name,
        subunitName: null,
        status: rec.status,
        absenceReason: rec.absenceReason,
        absenceNote: rec.absenceNote,
      });
    }
  }

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
