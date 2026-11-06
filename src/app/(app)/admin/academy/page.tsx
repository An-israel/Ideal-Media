import { notFound } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { getSessionRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { academySummary } from "@/lib/academy-import";
import { academyMigrations } from "@/lib/schema-check";
import { MigrationNotice } from "@/components/app/migration-notice";
import { PageHeader } from "@/components/app/page-header";
import { AdminNav } from "@/components/app/admin-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImportButton } from "./import-button";

export default async function AdminAcademyPage() {
  const session = await getSessionRoles();
  if (!session) return null;
  if (!session.roles.includes("super_admin")) notFound();

  const summary = academySummary();
  const needs = await academyMigrations();

  if (needs.length > 0) {
    return (
      <div>
        <AdminNav />
        <PageHeader title="Skills Academy" description="Load the courses into the site." />
        <MigrationNotice needs={needs} />
      </div>
    );
  }

  const admin = createAdminClient();
  const [{ count: courses }, { count: lessons }, { count: certificates }] = await Promise.all([
    admin.from("academy_courses").select("id", { count: "exact", head: true }),
    admin.from("academy_lessons").select("id", { count: "exact", head: true }),
    admin.from("academy_certificates").select("id", { count: "exact", head: true }),
  ]);

  return (
    <div>
      <AdminNav />
      <PageHeader
        title="Skills Academy"
        description="The courses ship with the app. This loads them into the database."
      />

      <Card className="mb-6">
        <CardHeader className="gap-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <GraduationCap className="h-4 w-4" /> {summary.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["Courses", summary.courses],
              ["Modules", summary.modules],
              ["Lessons", summary.lessons],
              ["Videos", summary.videos],
            ].map(([label, value]) => (
              <div key={label as string}>
                <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
                <dd className="text-xl font-semibold">{value}</dd>
              </div>
            ))}
          </dl>

          <p className="text-sm text-[var(--text-muted)]">
            {courses === 0 ? (
              <>Nothing has been loaded yet. Importing adds all {summary.courses} courses.</>
            ) : (
              <>
                Loaded now: {courses} courses and {lessons} lessons
                {certificates ? `, ${certificates} certificates issued` : ""}. Importing again
                updates the content in place — it matches courses by their slug and lessons by
                their position, so nobody&apos;s progress or certificate is lost.
              </>
            )}
          </p>

          <ImportButton />
        </CardContent>
      </Card>
    </div>
  );
}
