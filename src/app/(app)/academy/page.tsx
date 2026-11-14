import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { getSessionRoles } from "@/lib/auth";
import { academyMigrations } from "@/lib/schema-check";
import { MigrationNotice } from "@/components/app/migration-notice";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { AcademyIndex } from "@/components/academy/academy-index";

export default async function AcademyPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const session = await getSessionRoles();
  if (!session) return null;

  const needs = await academyMigrations();
  if (needs.length > 0) {
    return (
      <div>
        <PageHeader
          title="Skills Academy"
          description="Learn a skill, at your own pace, on the device you own."
        />
        <MigrationNotice needs={needs} />
      </div>
    );
  }

  const { category } = await searchParams;
  const canSeeReport =
    session.roles.includes("super_admin") ||
    session.roles.includes("secretary") ||
    session.ledSubunitIds.length > 0;

  return (
    <AcademyIndex
      userId={session.userId}
      basePath="/academy"
      category={category}
      audience="everyone in the department"
      emptyHint={
        session.roles.includes("super_admin") ? (
          <>
            Load them from <strong>Admin → Skills Academy</strong>.
          </>
        ) : undefined
      }
      actions={
        canSeeReport ? (
          <div className="mb-4">
            <Link href="/academy/report">
              <Button variant="outline" size="sm">
                <BarChart3 className="h-4 w-4" /> See who is learning what
              </Button>
            </Link>
          </div>
        ) : undefined
      }
    />
  );
}
