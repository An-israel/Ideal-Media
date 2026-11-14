import { notFound } from "next/navigation";
import { getSessionRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/pagination";
import { learnerMigrations } from "@/lib/schema-check";
import { MigrationNotice } from "@/components/app/migration-notice";
import { PageHeader } from "@/components/app/page-header";
import { AdminNav } from "@/components/app/admin-nav";
import { Card, CardContent } from "@/components/ui/card";
import { LearnersTable, type LearnerRow } from "./learners-table";

/**
 * Everyone who joined only for the courses.
 *
 * Kept on its own page, away from Members: these people are not part of the
 * department and are never counted in its roster, attendance or reports.
 */
export default async function AdminLearnersPage() {
  const session = await getSessionRoles();
  if (!session?.roles.includes("super_admin")) notFound();

  const needs = await learnerMigrations();
  if (needs.length > 0) {
    return (
      <div>
        <AdminNav />
        <PageHeader title="Course learners" description="People who joined only for the courses." />
        <MigrationNotice needs={needs} />
      </div>
    );
  }

  const admin = createAdminClient();
  const learners = await fetchAllRows<{
    id: string;
    full_name: string;
    email: string;
    phone: string | null;
    created_at: string;
    suspended_at: string | null;
    suspended_reason: string | null;
  }>((from, to) =>
    admin
      .from("learners")
      .select("id, full_name, email, phone, created_at, suspended_at, suspended_reason")
      .order("created_at", { ascending: false })
      .range(from, to)
  );

  const ids = learners.map((l) => l.id);
  const [progress, certificates, lessons, modules] = ids.length
    ? await Promise.all([
        fetchAllRows<{ user_id: string; lesson_id: string; completed_at: string }>((from, to) =>
          admin
            .from("academy_lesson_progress")
            .select("user_id, lesson_id, completed_at")
            .in("user_id", ids)
            .order("id")
            .range(from, to)
        ),
        fetchAllRows<{ user_id: string }>((from, to) =>
          admin.from("academy_certificates").select("user_id").in("user_id", ids).order("id").range(from, to)
        ),
        fetchAllRows<{ id: string; module_id: string }>((from, to) =>
          admin.from("academy_lessons").select("id, module_id").range(from, to)
        ),
        fetchAllRows<{ id: string; course_id: string }>((from, to) =>
          admin.from("academy_modules").select("id, course_id").range(from, to)
        ),
      ])
    : [[], [], [], []];

  const courseOfModule = new Map(modules.map((m) => [m.id, m.course_id]));
  const courseOfLesson = new Map(lessons.map((l) => [l.id, courseOfModule.get(l.module_id)]));
  const coursesOf = new Map<string, Set<string>>();
  const lessonsOf = new Map<string, number>();
  const lastOf = new Map<string, string>();
  for (const p of progress) {
    lessonsOf.set(p.user_id, (lessonsOf.get(p.user_id) ?? 0) + 1);
    const c = courseOfLesson.get(p.lesson_id);
    if (c) coursesOf.set(p.user_id, (coursesOf.get(p.user_id) ?? new Set()).add(c));
    if (!lastOf.has(p.user_id) || p.completed_at > lastOf.get(p.user_id)!) {
      lastOf.set(p.user_id, p.completed_at);
    }
  }
  const certsOf = new Map<string, number>();
  for (const c of certificates) certsOf.set(c.user_id, (certsOf.get(c.user_id) ?? 0) + 1);

  const rows: LearnerRow[] = learners.map((l) => ({
    id: l.id,
    fullName: l.full_name,
    email: l.email,
    phone: l.phone,
    joined: l.created_at,
    suspended: l.suspended_at !== null,
    suspendedReason: l.suspended_reason,
    coursesStarted: coursesOf.get(l.id)?.size ?? 0,
    lessonsDone: lessonsOf.get(l.id) ?? 0,
    certificates: certsOf.get(l.id) ?? 0,
    lastActive: lastOf.get(l.id) ?? null,
  }));

  const active = rows.filter((r) => r.lessonsDone > 0).length;
  const certs = rows.reduce((n, r) => n + r.certificates, 0);

  return (
    <div>
      <AdminNav />
      <PageHeader
        title="Course learners"
        description="People outside the media department who joined only for the Skills Academy. They are never part of the roster, attendance or reports."
      />
      <div className="mb-6 grid grid-cols-3 gap-4">
        {[
          ["Signed up", rows.length],
          ["Learning", active],
          ["Certificates", certs],
        ].map(([label, value]) => (
          <Card key={label as string}>
            <CardContent className="py-4">
              <p className="text-xs text-[var(--text-muted)]">{label}</p>
              <p className="text-2xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <LearnersTable rows={rows} />
    </div>
  );
}
