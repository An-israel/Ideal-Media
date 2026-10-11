import Link from "next/link";
import { ClipboardList, FileText, ClipboardPaste, AlertTriangle, CheckCircle2 } from "lucide-react";
import { getSessionRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServiceActivities, getSubmissions } from "@/lib/attendance-queries";
import { openServiceDates, deadlineFor, formatWAT, isLate } from "@/lib/attendance-window";
import { formatReportDate } from "@/lib/attendance-report";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AttendanceHubPage() {
  const session = await getSessionRoles();
  if (!session) return null;

  const privileged =
    session.roles.includes("super_admin") ||
    session.roles.includes("secretary") ||
    session.roles.includes("welfare");
  const canSubmit = privileged || session.ledSubunitIds.length > 0;
  if (!canSubmit) return null;

  const admin = createAdminClient();
  const { sunday, bibleStudy } = await getServiceActivities();
  const dates = openServiceDates();

  // Which subunits this person is responsible for.
  const { data: allSubunits } = await admin.from("subunits").select("id, name").order("name");
  const mine = privileged
    ? allSubunits ?? []
    : (allSubunits ?? []).filter((s) => session.ledSubunitIds.includes(s.id));

  const services = [
    sunday ? { activity: sunday, date: dates.sunday, label: "Sunday Service" } : null,
    bibleStudy ? { activity: bibleStudy, date: dates.wednesday, label: "Bible Study" } : null,
  ].filter(Boolean) as { activity: { id: string; name: string }; date: string; label: string }[];

  const submissionsByService = await Promise.all(
    services.map((s) => getSubmissions(s.activity.id, s.date))
  );

  return (
    <div>
      <PageHeader
        title="Attendance"
        description="Report who was present for each service. Sunday is due Monday 8PM; Bible Study is due Thursday 8PM."
      />

      {privileged && (
        <div className="mb-6 flex flex-wrap gap-2">
          <Link href="/attendance/paste">
            <Button variant="outline" size="sm">
              <ClipboardPaste className="h-4 w-4" /> Paste an absentee list
            </Button>
          </Link>
          <Link href="/attendance/report">
            <Button variant="outline" size="sm">
              <FileText className="h-4 w-4" /> Generate the department report
            </Button>
          </Link>
        </div>
      )}

      <div className="space-y-6">
        {services.map((s, i) => {
          const submissions = submissionsByService[i];
          const deadline = deadlineFor(s.date);
          const overdue = isLate(s.date);
          const outstanding = mine.filter((su) => !submissions.has(su.id));

          return (
            <Card key={s.activity.id}>
              <CardHeader className="gap-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">
                    {s.label} — {formatReportDate(s.date)}
                  </CardTitle>
                  {outstanding.length === 0 ? (
                    <Badge variant="success">All in</Badge>
                  ) : overdue ? (
                    <Badge variant="danger">Overdue</Badge>
                  ) : (
                    <Badge variant="neutral">{outstanding.length} outstanding</Badge>
                  )}
                </div>
                <p className="text-sm text-[var(--text-muted)]">
                  Due {formatWAT(deadline)} WAT
                  {overdue && " — submissions are still accepted and will be marked late."}
                </p>
              </CardHeader>

              <CardContent className="divide-y divide-[var(--border)] p-0">
                {mine.length === 0 && (
                  <p className="px-5 py-6 text-sm text-[var(--text-muted)]">
                    You don&apos;t lead a subunit yet, so there is nothing to submit here.
                  </p>
                )}
                {mine.map((su) => {
                  const sub = submissions.get(su.id);
                  return (
                    <div key={su.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{su.name}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {sub?.noService
                            ? `No service held${sub.noServiceReason ? ` — ${sub.noServiceReason}` : ""}`
                            : sub
                              ? `${sub.presentCount} present, ${sub.absentCount} absent`
                              : "Not submitted"}
                        </p>
                      </div>
                      {sub?.noService ? (
                        <Badge variant="neutral">No service</Badge>
                      ) : sub ? (
                        <Badge variant={sub.isLate ? "warning" : "success"}>
                          {sub.isLate ? "Late" : "Submitted"}
                        </Badge>
                      ) : (
                        <Badge variant="neutral">Pending</Badge>
                      )}
                      <Link
                        href={`/attendance/submit?subunit=${su.id}&activity=${s.activity.id}&date=${s.date}`}
                      >
                        <Button size="sm" variant={sub ? "outline" : "default"}>
                          <ClipboardList className="h-4 w-4" />
                          {sub ? "Edit" : "Submit"}
                        </Button>
                      </Link>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}

        {services.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <AlertTriangle className="h-8 w-8 text-[var(--text-muted)]" />
              <p className="text-sm text-[var(--text-muted)]">
                Neither &ldquo;Sunday Service&rdquo; nor &ldquo;Bible Study&rdquo; exists as an
                activity. Add them under Admin → Activities.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {privileged && (
        <p className="mt-6 flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <CheckCircle2 className="h-3 w-3" />
          You can submit for any subunit. Leaders only see their own.
        </p>
      )}
    </div>
  );
}
