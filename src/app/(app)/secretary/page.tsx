import { createClient } from "@/lib/supabase/server";
import { SecretaryWorkspace, type GridMember, type MonthGroup } from "./secretary-workspace";

function monthLabel(period: string) {
  const d = new Date(`${period}-01T00:00:00`);
  return isNaN(d.getTime())
    ? period
    : d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

export default async function SecretaryPage({
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
  const activityId = activity || list.find((a) => a.is_attendance_signal)?.id || list[0]?.id || "";

  let monthGroups: MonthGroup[] = [];
  const gridMembers: GridMember[] = [];

  if (activityId) {
    const [{ data: members }, { data: records }, { data: summaryRows }] = await Promise.all([
      supabase
        .from("subunit_members")
        .select("user_id, profiles(full_name), subunits(name)")
        .eq("membership_type", "primary"),
      supabase
        .from("attendance_records")
        .select("user_id, service_date, status")
        .eq("activity_id", activityId)
        .order("service_date", { ascending: false })
        .limit(4000),
      supabase.from("monthly_attendance_summary").select("user_id, period, count"),
    ]);

    // Most recent 14 service dates, oldest-first for display.
    const dates = [...new Set((records ?? []).map((r) => r.service_date))].slice(0, 14).reverse();

    const byUser = new Map<string, Record<string, string>>();
    for (const r of records ?? []) {
      const m = byUser.get(r.user_id) ?? {};
      m[r.service_date] = r.status;
      byUser.set(r.user_id, m);
    }

    // Historical monthly tallies (whole-team counts for past months).
    const summaryByUser = new Map<string, Record<string, number>>();
    const summaryPeriods = new Set<string>();
    for (const s of summaryRows ?? []) {
      summaryPeriods.add(s.period);
      const m = summaryByUser.get(s.user_id) ?? {};
      m[s.period] = s.count;
      summaryByUser.set(s.user_id, m);
    }

    // Build chronological month groups: summary-only months first, then months
    // with per-service date columns. Each group ends in an auto "Total".
    const datePeriods = new Set(dates.map((d) => d.slice(0, 7)));
    const allPeriods = [...new Set([...summaryPeriods, ...datePeriods])].sort();
    monthGroups = allPeriods.map((period) => ({
      key: period,
      label: monthLabel(period),
      dates: dates.filter((d) => d.slice(0, 7) === period),
      summaryOnly: !datePeriods.has(period),
    }));

    type Row = { user_id: string; profiles: { full_name: string } | null; subunits: { name: string } | null };
    const seen = new Set<string>();
    for (const m of (members ?? []) as unknown as Row[]) {
      if (!m.profiles || seen.has(m.user_id)) continue;
      seen.add(m.user_id);
      const statuses = byUser.get(m.user_id) ?? {};
      const counted = dates.filter((d) => statuses[d] === "present" || statuses[d] === "absent");
      const present = counted.filter((d) => statuses[d] === "present").length;
      gridMembers.push({
        id: m.user_id,
        name: m.profiles.full_name,
        subunit: m.subunits?.name ?? "",
        statuses,
        summary: summaryByUser.get(m.user_id) ?? {},
        rate: counted.length ? Math.round((present / counted.length) * 100) : null,
      });
    }
    gridMembers.sort((a, b) => a.name.localeCompare(b.name));
  }

  return (
    <SecretaryWorkspace
      activities={list}
      activeActivityId={activityId}
      monthGroups={monthGroups}
      members={gridMembers}
    />
  );
}
