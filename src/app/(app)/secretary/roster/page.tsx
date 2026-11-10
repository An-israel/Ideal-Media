import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/pagination";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RosterTable, UNASSIGNED, type RosterRow } from "./roster-table";
import type { MemberStatus } from "@/lib/database.types";

export default async function RosterPage() {
  const supabase = await createClient();

  // EVERY member, with their primary subunit looked up separately.
  //
  // This used to read subunit_members where membership_type = 'primary' and
  // take the profile from each row — so a member with no primary subunit was
  // not on the roster at all. That was survivable while everyone had one. It
  // stopped being so once accounts could be created ahead of their unit, and
  // once restoring a removed member brought them back without the membership
  // they used to hold: they were active, and invisible in the one place a
  // secretary could have given them a unit.
  const [profiles, memberships] = await Promise.all([
    fetchAllRows<{
      id: string;
      full_name: string;
      member_status: MemberStatus;
      location: string | null;
      member_origin: string;
      claimed: boolean;
    }>((from, to) =>
      supabase
        .from("profiles")
        .select("id, full_name, member_status, location, member_origin, claimed")
        .order("id")
        .range(from, to)
    ),
    fetchAllRows<{ user_id: string; subunits: { name: string } | null }>((from, to) =>
      supabase
        .from("subunit_members")
        .select("user_id, subunits(name)")
        .eq("membership_type", "primary")
        .order("user_id")
        .range(from, to) as unknown as PromiseLike<{
        data: { user_id: string; subunits: { name: string } | null }[] | null;
        error: { message: string } | null;
      }>
    ),
  ]);

  const { data: subunits } = await supabase
    .from("subunits")
    .select("id, name")
    .eq("category", "primary")
    .order("name");

  const primaryOf = new Map(memberships.map((m) => [m.user_id, m.subunits?.name ?? null]));
  const rows: RosterRow[] = profiles
    .map((p) => ({
      id: p.id,
      name: p.full_name,
      status: p.member_status,
      location: p.location,
      subunit: primaryOf.get(p.id) ?? UNASSIGNED,
      origin: p.member_origin,
      claimed: p.claimed,
    }))
    .sort((x, y) => x.name.localeCompare(y.name));

  // "Recently missed service": absentees on the latest signal-activity session.
  const { data: signal } = await supabase
    .from("activities")
    .select("id")
    .eq("is_attendance_signal", true)
    .limit(1)
    .maybeSingle();

  let recentlyMissed: string[] = [];
  if (signal) {
    const { data: latest } = await supabase
      .from("attendance_records")
      .select("service_date")
      .eq("activity_id", signal.id)
      .order("service_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest) {
      const { data: absentees } = await supabase
        .from("attendance_records")
        .select("user_id, profiles(full_name)")
        .eq("activity_id", signal.id)
        .eq("service_date", latest.service_date)
        .eq("status", "absent");
      type A = { profiles: { full_name: string } | null };
      recentlyMissed = ((absentees ?? []) as unknown as A[])
        .map((a) => a.profiles?.full_name)
        .filter((n): n is string => !!n);
    }
  }

  // Only people still on the roll: somebody who has left or graduated having
  // no subunit is expected, not a job waiting to be done.
  const unassigned = rows.filter(
    (r) => r.subunit === UNASSIGNED && !["left", "graduated"].includes(r.status)
  ).length;

  return (
    <div>
      <PageHeader title="Roster" description="Categorize members and review who's missing service." />

      {recentlyMissed.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Absent at the most recent service ({recentlyMissed.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {recentlyMissed.map((n, i) => (
              <span key={i} className="rounded-full bg-[var(--bg)] px-3 py-1 text-sm text-[var(--text-muted)]">
                {n}
              </span>
            ))}
          </CardContent>
        </Card>
      )}

      {unassigned > 0 && (
        <Card className="mb-6 border-[var(--warning)]/50">
          <CardContent className="py-4 text-sm">
            <strong>
              {unassigned} {unassigned === 1 ? "member has" : "members have"} no subunit yet.
            </strong>{" "}
            <span className="text-[var(--text-muted)]">
              Nobody takes their attendance until they have one. Choose{" "}
              <em>No subunit yet</em> in the filter below, tick them, pick the unit and press{" "}
              <em>Move</em>.
            </span>
          </CardContent>
        </Card>
      )}

      <RosterTable rows={rows} subunits={subunits ?? []} />
    </div>
  );
}
