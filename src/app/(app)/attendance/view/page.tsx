import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Info } from "lucide-react";
import { getSessionRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSubunitMembership, getRecordsFor, getSubmissions } from "@/lib/attendance-queries";
import { hasOccurred } from "@/lib/attendance-window";
import { formatReportDate } from "@/lib/attendance-report";
import { reasonLabel } from "@/lib/absence-reasons";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * A secondary subunit's members, read-only.
 *
 * Secondary units don't take their own attendance: everyone in them is counted
 * by their primary unit, which is what keeps the department total equal to the
 * sum of the subunits. This page exists so that the leader of such a unit can
 * still see their people and what was recorded for them, instead of an empty
 * list that looks like the members went missing.
 */
export default async function ViewSubunitAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ subunit?: string; activity?: string; date?: string }>;
}) {
  const { subunit, activity, date } = await searchParams;
  if (!subunit || !activity || !date) notFound();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const session = await getSessionRoles();
  if (!session) return null;

  const privileged =
    session.roles.includes("super_admin") ||
    session.roles.includes("secretary") ||
    session.roles.includes("welfare");
  if (!privileged && !session.ledSubunitIds.includes(subunit)) notFound();

  const admin = createAdminClient();
  const [{ data: subunitRow }, { data: activityRow }, members] = await Promise.all([
    admin.from("subunits").select("id, name, category").eq("id", subunit).maybeSingle(),
    admin.from("activities").select("id, name").eq("id", activity).maybeSingle(),
    getSubunitMembership(subunit),
  ]);
  if (!subunitRow || !activityRow) notFound();

  const held = hasOccurred(date);
  // Read these unconditionally: a service still to come simply has no records,
  // and branching on `held` would make their types optional for no gain.
  const [records, submissions] = await Promise.all([
    getRecordsFor(
      activity,
      date,
      members.map((m) => m.userId)
    ),
    getSubmissions(activity, date),
  ]);

  const present = members.filter((m) => records.get(m.userId)?.status === "present").length;
  const reported = members.filter((m) => records.has(m.userId)).length;

  return (
    <div>
      <PageHeader
        title={`${subunitRow.name} — ${activityRow.name}`}
        description={formatReportDate(date)}
      />

      <div className="mb-6">
        <Link href={`/attendance?week=${date}`}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4" /> Back to attendance
          </Button>
        </Link>
      </div>

      <Card className="mb-6">
        <CardContent className="flex gap-3 py-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          <p className="text-sm text-[var(--text-muted)]">
            {subunitRow.name} is a secondary unit, so it doesn&apos;t file its own attendance —
            everyone here is counted once, by the unit they belong to primarily. That is why the
            department total adds up. This page shows your {members.length}{" "}
            {members.length === 1 ? "member" : "members"} and what their unit recorded for them.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Members ({members.length})</CardTitle>
            {held && (
              <Badge variant="neutral">
                {present} present of {reported} reported
              </Badge>
            )}
          </div>
          {held && reported < members.length && (
            <p className="text-sm text-[var(--text-muted)]">
              {members.length - reported} not reported yet by their own unit.
            </p>
          )}
        </CardHeader>
        <CardContent className="divide-y divide-[var(--border)] p-0">
          {members.length === 0 && (
            <p className="px-5 py-6 text-sm text-[var(--text-muted)]">
              Nobody is in this unit yet. Add members under Admin → Members.
            </p>
          )}
          {members.map((m) => {
            const rec = records.get(m.userId);
            const sub = m.reportingSubunitId ? submissions.get(m.reportingSubunitId) : undefined;
            return (
              <div key={m.userId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.fullName}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {m.reportingSubunitName
                      ? `Counted under ${m.reportingSubunitName}`
                      : "No primary unit — nobody reports this person yet"}
                    {rec?.absenceReason ? ` · ${reasonLabel(rec.absenceReason)}` : ""}
                  </p>
                </div>
                {!held ? (
                  <Badge variant="neutral">Not held yet</Badge>
                ) : rec?.status === "present" ? (
                  <Badge variant="success">Present</Badge>
                ) : rec ? (
                  <Badge variant="warning">{rec.status === "traveled" ? "Traveled" : "Absent"}</Badge>
                ) : sub ? (
                  <Badge variant="danger">Absent</Badge>
                ) : (
                  <Badge variant="neutral">Not reported</Badge>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
