import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { AttendanceGrid, type GridMember } from "./attendance-grid";

export default async function AttendanceRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ activity?: string }>;
}) {
  const { activity } = await searchParams;
  const supabase = await createClient();

  const { data: activities } = await supabase
    .from("activities")
    .select("id, name, is_attendance_signal")
    .order("name");
  const list = activities ?? [];
  const activityId = activity || list.find((a) => a.is_attendance_signal)?.id || list[0]?.id;

  if (!activityId) {
    return (
      <div>
        <PageHeader title="Attendance records" />
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--text-muted)]">
            No activities set up yet.
          </CardContent>
        </Card>
      </div>
    );
  }

  const [{ data: members }, { data: records }] = await Promise.all([
    supabase
      .from("subunit_members")
      .select("user_id, profiles(full_name)")
      .eq("membership_type", "primary"),
    supabase
      .from("attendance_records")
      .select("user_id, service_date, status")
      .eq("activity_id", activityId)
      .order("service_date", { ascending: false })
      .limit(4000),
  ]);

  // Most recent 10 service dates (chronological, oldest → newest left-to-right).
  const dates = [...new Set((records ?? []).map((r) => r.service_date))].slice(0, 10).reverse();

  // user_id → date → status
  const byUser = new Map<string, Record<string, string>>();
  for (const r of records ?? []) {
    const m = byUser.get(r.user_id) ?? {};
    m[r.service_date] = r.status;
    byUser.set(r.user_id, m);
  }

  type Row = { user_id: string; profiles: { full_name: string } | null };
  const seen = new Set<string>();
  const gridMembers: GridMember[] = [];
  for (const m of (members ?? []) as unknown as Row[]) {
    if (!m.profiles || seen.has(m.user_id)) continue;
    seen.add(m.user_id);
    const statuses = byUser.get(m.user_id) ?? {};
    const counted = dates.filter((d) => statuses[d] === "present" || statuses[d] === "absent");
    const present = counted.filter((d) => statuses[d] === "present").length;
    gridMembers.push({
      id: m.user_id,
      name: m.profiles.full_name,
      statuses,
      rate: counted.length ? Math.round((present / counted.length) * 100) : null,
    });
  }
  gridMembers.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <PageHeader title="Attendance records" description="Who attended each service." />
      <AttendanceGrid
        activities={list}
        activeActivityId={activityId}
        dates={dates}
        members={gridMembers}
      />
    </div>
  );
}
