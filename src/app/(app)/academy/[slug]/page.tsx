import { getSessionRoles } from "@/lib/auth";
import { academyMigrations } from "@/lib/schema-check";
import { MigrationNotice } from "@/components/app/migration-notice";
import { PageHeader } from "@/components/app/page-header";
import { CourseView } from "@/components/academy/course-view";

export default async function AcademyCoursePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await getSessionRoles();
  if (!session) return null;

  const needs = await academyMigrations();
  if (needs.length > 0) {
    return (
      <div>
        <PageHeader title="Skills Academy" description="" />
        <MigrationNotice needs={needs} />
      </div>
    );
  }

  const { slug } = await params;
  return <CourseView slug={slug} userId={session.userId} basePath="/academy" />;
}
