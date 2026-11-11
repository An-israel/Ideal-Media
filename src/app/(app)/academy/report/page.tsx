import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Award } from "lucide-react";
import { getSessionRoles } from "@/lib/auth";
import { getAcademyReport } from "@/lib/academy-report-queries";
import { academyMigrations } from "@/lib/schema-check";
import { MigrationNotice } from "@/components/app/migration-notice";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Who is learning what in the Skills Academy.
 *
 * The whole department for the super admin and the secretary; a leader sees
 * the members of the subunits they lead. Anyone else gets a 404 rather than an
 * empty report, so the address does not confirm that the page exists.
 */
export default async function AcademyReportPage() {
  const session = await getSessionRoles();
  if (!session) return null;

  const wholeDepartment =
    session.roles.includes("super_admin") || session.roles.includes("secretary");
  if (!wholeDepartment && session.ledSubunitIds.length === 0) notFound();

  const needs = await academyMigrations();
  if (needs.length > 0) {
    return (
      <div>
        <PageHeader title="Academy report" description="" />
        <MigrationNotice needs={needs} />
      </div>
    );
  }

  const report = await getAcademyReport(wholeDepartment ? undefined : session.ledSubunitIds);
  const activeCourses = report.courses.filter((c) => c.started > 0);

  return (
    <div>
      <div className="mb-6">
        <Link href="/academy">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4" /> Skills Academy
          </Button>
        </Link>
      </div>

      <PageHeader
        title="Academy report"
        description={
          wholeDepartment
            ? "Everyone in the department: who has started a course, how far they are, and who has finished."
            : "The members of the subunits you lead: who has started a course, how far they are, and who has finished."
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Members", report.totals.members],
          ["Learning", report.totals.learning],
          ["Courses finished", report.totals.finishedCourses],
          ["Certificates", report.totals.certificates],
        ].map(([label, value]) => (
          <Card key={label as string}>
            <CardContent className="py-4">
              <p className="text-xs text-[var(--text-muted)]">{label}</p>
              <p className="text-2xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mb-6">
        <CardHeader className="gap-1">
          <CardTitle className="text-base">By course</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {activeCourses.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-[var(--text-muted)]">
              Nobody has started a course yet.
            </p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              <div className="grid grid-cols-[1fr_4rem_4rem_4rem] gap-3 px-5 py-2 text-xs font-medium text-[var(--text-muted)]">
                <span>Course</span>
                <span className="text-right">Started</span>
                <span className="text-right">Finished</span>
                <span className="text-right">Certs</span>
              </div>
              {activeCourses.map((c) => (
                <div
                  key={c.id}
                  className="grid grid-cols-[1fr_4rem_4rem_4rem] items-center gap-3 px-5 py-2.5 text-sm"
                >
                  <Link href={`/academy/${c.slug}`} className="truncate hover:underline">
                    {c.title}
                  </Link>
                  <span className="text-right">{c.started}</span>
                  <span className="text-right">{c.finished}</span>
                  <span className="text-right">{c.certificates}</span>
                </div>
              ))}
            </div>
          )}
          {activeCourses.length > 0 && activeCourses.length < report.courses.length && (
            <p className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--text-muted)]">
              {report.courses.length - activeCourses.length} other courses have not been started
              by anyone here.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="gap-1">
          <CardTitle className="text-base">By member ({report.members.length})</CardTitle>
          <p className="text-sm text-[var(--text-muted)]">Most recently active first.</p>
        </CardHeader>
        <CardContent className="divide-y divide-[var(--border)] p-0">
          {report.members.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-[var(--text-muted)]">
              No activity yet.
            </p>
          )}
          {report.members.map((m) => (
            <div key={m.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{m.fullName}</p>
                {m.certificates > 0 && (
                  <Badge variant="success">
                    <Award className="h-3 w-3" /> {m.certificates}
                  </Badge>
                )}
                {m.lastActivity && (
                  <span className="text-xs text-[var(--text-muted)]">
                    Last active{" "}
                    {new Date(m.lastActivity).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                )}
              </div>
              <ul className="mt-2 space-y-1.5">
                {m.courses.map((c) => (
                  <li key={c.courseId} className="flex items-center gap-3 text-xs">
                    <span className="w-40 shrink-0 truncate sm:w-56">{c.title}</span>
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--border)]">
                      <span
                        className={`block h-full rounded-full ${
                          c.finished ? "bg-[var(--success)]" : "bg-[var(--accent)]"
                        }`}
                        style={{ width: `${c.percent}%` }}
                      />
                    </span>
                    <span className="w-16 shrink-0 text-right text-[var(--text-muted)]">
                      {c.done}/{c.total}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>

      {report.notStarted.length > 0 && (
        <Card>
          <CardHeader className="gap-1">
            <CardTitle className="text-base">
              Not started anything ({report.notStarted.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {report.notStarted.map((m) => (
              <span
                key={m.id}
                className="rounded-full bg-[var(--bg)] px-3 py-1 text-sm text-[var(--text-muted)]"
              >
                {m.fullName}
              </span>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
