import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent } from "@/components/ui/card";
import { AdminCharts } from "./admin-charts";

export default async function AdminOverviewPage() {
  const admin = createAdminClient();

  const [
    { count: total },
    { count: active },
    { count: cocDone },
    { count: submitted },
    { count: pendingApps },
    { count: welfareQueue },
  ] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("member_status", "active"),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("coc_completed", true),
    admin.from("module_progress").select("id", { count: "exact", head: true }).eq("status", "submitted"),
    admin.from("enrollments").select("id", { count: "exact", head: true }).eq("status", "pending_application"),
    admin.from("welfare_followups").select("id", { count: "exact", head: true }).neq("status", "resolved"),
  ]);

  const totalMembers = total ?? 0;
  const cocRate = totalMembers ? Math.round(((cocDone ?? 0) / totalMembers) * 100) : 0;

  // Attendance trend: present count per service date, per activity.
  const { data: attendance } = await admin
    .from("attendance_records")
    .select("service_date, status, activities(name)")
    .order("service_date", { ascending: true });
  type AttRow = { service_date: string; status: string; activities: { name: string } | null };
  const attRows = (attendance ?? []) as unknown as AttRow[];

  const trendMap = new Map<string, Record<string, number>>();
  const activityNames = new Set<string>();
  for (const r of attRows) {
    const name = r.activities?.name ?? "Unknown";
    activityNames.add(name);
    const entry = trendMap.get(r.service_date) ?? {};
    if (r.status === "present") entry[name] = (entry[name] ?? 0) + 1;
    trendMap.set(r.service_date, entry);
  }
  const attendanceTrend = [...trendMap.entries()]
    .map(([date, counts]) => ({ date, ...counts }))
    .slice(-12);

  // Course completion rate per subunit.
  const [{ data: subunits }, { data: courses }, { data: modules }, { data: enrollments }, { data: progress }] =
    await Promise.all([
      admin.from("subunits").select("id, name"),
      admin.from("courses").select("id, subunit_id"),
      admin.from("modules").select("id, course_id"),
      admin.from("enrollments").select("course_id").eq("status", "enrolled"),
      admin.from("module_progress").select("module_id, status").eq("status", "approved"),
    ]);

  const courseSubunit = new Map((courses ?? []).map((c) => [c.id, c.subunit_id]));
  const moduleCountByCourse = new Map<string, number>();
  const moduleCourse = new Map<string, string>();
  for (const m of modules ?? []) {
    moduleCountByCourse.set(m.course_id, (moduleCountByCourse.get(m.course_id) ?? 0) + 1);
    moduleCourse.set(m.id, m.course_id);
  }
  const expectedBySubunit = new Map<string, number>();
  for (const e of enrollments ?? []) {
    const subunit = courseSubunit.get(e.course_id);
    if (!subunit) continue;
    expectedBySubunit.set(
      subunit,
      (expectedBySubunit.get(subunit) ?? 0) + (moduleCountByCourse.get(e.course_id) ?? 0)
    );
  }
  const approvedBySubunit = new Map<string, number>();
  for (const p of progress ?? []) {
    const course = moduleCourse.get(p.module_id);
    const subunit = course ? courseSubunit.get(course) : undefined;
    if (!subunit) continue;
    approvedBySubunit.set(subunit, (approvedBySubunit.get(subunit) ?? 0) + 1);
  }
  const completion = (subunits ?? [])
    .map((s) => {
      const expected = expectedBySubunit.get(s.id) ?? 0;
      const approved = approvedBySubunit.get(s.id) ?? 0;
      return { subunit: s.name, rate: expected ? Math.round((approved / expected) * 100) : 0 };
    })
    .filter((c) => c.rate > 0 || expectedBySubunit.has((subunits ?? []).find((s) => s.name === c.subunit)?.id ?? ""));

  const cards = [
    { label: "Total members", value: totalMembers },
    { label: "Active", value: active ?? 0 },
    { label: "COC completion", value: `${cocRate}%` },
    { label: "Pending approvals", value: (submitted ?? 0) + (pendingApps ?? 0) },
    { label: "Welfare queue", value: welfareQueue ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="pt-6">
              <p className="text-sm text-[var(--text-muted)]">{c.label}</p>
              <p className="mt-1 text-2xl font-semibold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <AdminCharts
        attendanceTrend={attendanceTrend}
        activityNames={[...activityNames]}
        completion={completion}
      />
    </div>
  );
}
