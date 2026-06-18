import { notFound } from "next/navigation";
import { CheckCircle2, Circle, Clock, RotateCcw } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMemberPerformance } from "@/lib/queries";
import { PageHeader } from "@/components/app/page-header";
import { PerformanceRing } from "@/components/app/performance-ring";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { pct } from "@/lib/performance";
import type { ModuleProgressStatus } from "@/lib/database.types";

const STATUS_ICON: Record<ModuleProgressStatus, React.ReactNode> = {
  approved: <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />,
  submitted: <Clock className="h-4 w-4 text-[var(--accent)]" />,
  in_progress: <RotateCcw className="h-4 w-4 text-[var(--warning)]" />,
  not_started: <Circle className="h-4 w-4 text-[var(--text-muted)]" />,
};

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, phone, location, member_status")
    .eq("id", userId)
    .single();
  if (!profile) notFound();

  const [{ parts, composite }, { data: enrollments }, { data: progress }, { data: attendance }] =
    await Promise.all([
      getMemberPerformance(supabase, userId),
      supabase
        .from("enrollments")
        .select("course_id, courses(id, title)")
        .eq("user_id", userId)
        .eq("status", "enrolled"),
      supabase.from("module_progress").select("module_id, status").eq("user_id", userId),
      supabase
        .from("attendance_records")
        .select("status, service_date, activities(name)")
        .eq("user_id", userId)
        .order("service_date", { ascending: false })
        .limit(12),
    ]);

  const progressMap = new Map(
    (progress ?? []).map((p) => [p.module_id, p.status as ModuleProgressStatus])
  );

  type EnrollRow = { course_id: string; courses: { id: string; title: string } | null };
  const courseIds = ((enrollments ?? []) as unknown as EnrollRow[])
    .map((e) => e.courses?.id)
    .filter((id): id is string => !!id);

  const { data: modules } = courseIds.length
    ? await supabase
        .from("modules")
        .select("id, title, position, course_id")
        .in("course_id", courseIds)
        .order("position", { ascending: true })
    : { data: [] };

  const modulesByCourse = new Map<string, { id: string; title: string; position: number }[]>();
  for (const m of (modules ?? []) as { id: string; title: string; position: number; course_id: string }[]) {
    const list = modulesByCourse.get(m.course_id) ?? [];
    list.push(m);
    modulesByCourse.set(m.course_id, list);
  }

  type AttRow = { status: string; service_date: string; activities: { name: string } | null };
  const attRows = (attendance ?? []) as unknown as AttRow[];

  return (
    <div className="space-y-6">
      <PageHeader title={profile.full_name} description={profile.location ?? undefined} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Email" value={profile.email} />
            <Field label="Phone" value={profile.phone ?? "—"} />
            <Field label="Location" value={profile.location ?? "—"} />
            <div>
              <p className="text-[var(--text-muted)]">Status</p>
              <Badge variant="neutral">{profile.member_status}</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-center p-6">
            <PerformanceRing value={composite} parts={parts} size={120} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Course progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {((enrollments ?? []) as unknown as EnrollRow[]).length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">Not enrolled in any courses.</p>
          )}
          {((enrollments ?? []) as unknown as EnrollRow[]).map((e) => {
            if (!e.courses) return null;
            const mods = modulesByCourse.get(e.courses.id) ?? [];
            const approved = mods.filter((m) => progressMap.get(m.id) === "approved").length;
            return (
              <div key={e.courses.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{e.courses.title}</p>
                  <span className="text-xs text-[var(--text-muted)]">
                    {approved}/{mods.length} approved
                  </span>
                </div>
                <div className="space-y-1">
                  {mods.map((m) => {
                    const st = progressMap.get(m.id) ?? "not_started";
                    return (
                      <div key={m.id} className="flex items-center gap-2 text-sm">
                        {STATUS_ICON[st]}
                        <span className="text-[var(--text-muted)]">
                          {m.position}. {m.title}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent attendance</CardTitle>
        </CardHeader>
        <CardContent>
          {attRows.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No attendance recorded yet.</p>
          ) : (
            <div className="space-y-1">
              {attRows.map((a, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-[var(--text-muted)]">
                    {a.service_date} · {a.activities?.name}
                  </span>
                  <Badge
                    variant={
                      a.status === "present"
                        ? "success"
                        : a.status === "absent"
                        ? "danger"
                        : "neutral"
                    }
                  >
                    {a.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            Attendance rate (trailing window): {pct(parts.attendance)}%
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[var(--text-muted)]">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
