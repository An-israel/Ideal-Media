import Link from "next/link";
import Image from "next/image";
import { GraduationCap, CheckCircle2, BarChart3 } from "lucide-react";
import { getSessionRoles } from "@/lib/auth";
import { listCourses, courseProgressFor } from "@/lib/academy";
import { academyMigrations } from "@/lib/schema-check";
import { MigrationNotice } from "@/components/app/migration-notice";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CategoryFilter } from "./category-filter";

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

  const [courses, progress] = await Promise.all([
    listCourses(),
    courseProgressFor(session.userId),
  ]);

  if (courses.length === 0) {
    return (
      <div>
        <PageHeader
          title="Skills Academy"
          description="Learn a skill, at your own pace, on the device you own."
        />
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <GraduationCap className="h-8 w-8 text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">
              The courses haven&apos;t been loaded yet.
              {session.roles.includes("super_admin") && (
                <>
                  {" "}
                  Load them from <strong>Admin → Skills Academy</strong>.
                </>
              )}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { category } = await searchParams;
  const categories = [...new Set(courses.map((c) => c.category))].sort();
  const shown = category && categories.includes(category)
    ? courses.filter((c) => c.category === category)
    : courses;

  const canSeeReport =
    session.roles.includes("super_admin") ||
    session.roles.includes("secretary") ||
    session.ledSubunitIds.length > 0;

  const started = courses.filter((c) => (progress.get(c.id)?.done ?? 0) > 0).length;
  const finished = courses.filter((c) => progress.get(c.id)?.complete).length;

  return (
    <div>
      <PageHeader
        title="Skills Academy"
        description={
          started === 0
            ? `${courses.length} courses, free to everyone in the department. Pick one and start — nobody has to approve it.`
            : `You have started ${started} ${started === 1 ? "course" : "courses"}${
                finished > 0 ? ` and finished ${finished}` : ""
              }.`
        }
      />

      {canSeeReport && (
        <div className="mb-4">
          <Link href="/academy/report">
            <Button variant="outline" size="sm">
              <BarChart3 className="h-4 w-4" /> See who is learning what
            </Button>
          </Link>
        </div>
      )}

      <CategoryFilter categories={categories} active={category ?? null} />

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((course) => {
          const p = progress.get(course.id);
          const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
          return (
            <Link key={course.id} href={`/academy/${course.slug}`} className="group block">
              <Card className="overflow-hidden p-0 transition-shadow hover:shadow-lg">
                {/* The cover already carries the title, tagline and chips, so
                    the card does not repeat them underneath it. */}
                <div className="relative aspect-video w-full bg-[var(--border)]">
                  {course.cover_path && (
                    <Image
                      src={course.cover_path}
                      alt={course.title}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
                      className="object-cover"
                    />
                  )}
                  {p?.complete && (
                    <div className="absolute right-3 top-3">
                      <Badge variant="success">
                        <CheckCircle2 className="h-3 w-3" /> Completed
                      </Badge>
                    </div>
                  )}
                </div>
                <CardContent className="p-4">
                  {p && p.done > 0 ? (
                    <>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
                        <div
                          className="h-full rounded-full bg-[var(--accent)] transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-[var(--text-muted)]">
                        {p.done} of {p.total} steps done
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-[var(--text-muted)]">
                      {course.weeks ? `${course.weeks} weeks` : course.level} ·{" "}
                      {course.dual ? "Phone or laptop" : "Laptop recommended"}
                    </p>
                  )}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
