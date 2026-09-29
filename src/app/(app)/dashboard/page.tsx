import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionRoles } from "@/lib/auth";
import { getMemberPerformance } from "@/lib/queries";
import { PageHeader } from "@/components/app/page-header";
import { PerformanceRing } from "@/components/app/performance-ring";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GraduationCap, Headphones, Network, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTrainingForMember } from "@/lib/training";

export default async function DashboardPage() {
  const session = await getSessionRoles();
  if (!session) return null;
  const supabase = await createClient();

  const [
    { data: memberships },
    { parts, composite },
    { data: enrollments },
    trainingSeries,
    { data: pendingSubunitRequest },
  ] = await Promise.all([
    supabase
      .from("subunit_members")
      .select("membership_type, subunits(name)")
      .eq("user_id", session.userId),
    getMemberPerformance(supabase, session.userId),
    supabase
      .from("enrollments")
      .select("status, courses(id, title, description, subunit_id)")
      .eq("user_id", session.userId)
      .eq("status", "enrolled"),
    // General Training is department-wide, so it belongs on everyone's
    // dashboard rather than behind a role.
    getTrainingForMember(supabase, session.userId),
    supabase
      .from("subunit_requests")
      .select("id, status")
      .eq("user_id", session.userId)
      .eq("status", "pending")
      .maybeSingle(),
  ]);

  const teachings = trainingSeries.flatMap((s) => s.teachings);
  const teachingsDone = teachings.filter((t) => t.completed).length;
  const nextTeaching = teachings.find((t) => !t.completed) ?? null;
  const trainingPercent = teachings.length
    ? Math.round((teachingsDone / teachings.length) * 100)
    : 0;

  // Embeds aren't modelled in our hand-maintained types (Relationships: []),
  // so name the shape once here rather than suppressing the error per usage.
  type MembershipRow = {
    membership_type: string;
    subunits: { name: string } | null;
  };
  const membershipRows = (memberships ?? []) as unknown as MembershipRow[];
  const primary = membershipRows.find((m) => m.membership_type === "primary");
  const secondaries = membershipRows.filter((m) => m.membership_type === "secondary");

  type EnrollmentRow = {
    status: string;
    courses: { id: string; title: string; description: string | null } | null;
  };
  const courses = ((enrollments ?? []) as unknown as EnrollmentRow[])
    .map((e) => e.courses)
    .filter((c): c is NonNullable<typeof c> => !!c);

  return (
    <div>
      <PageHeader title="Dashboard" description="Your subunits, courses, and performance." />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">Your subunits</CardTitle>
            <Link href="/subunits">
              <Button size="sm" variant="ghost">
                <Network className="h-4 w-4" /> Browse & join
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {primary && <Badge>{primary.subunits?.name} · Primary</Badge>}
              {secondaries.map((s, i) => (
                <Badge key={i} variant="neutral">
                  {s.subunits?.name}
                </Badge>
              ))}
              {!primary && secondaries.length === 0 && (
                <p className="text-sm text-[var(--text-muted)]">
                  No subunits assigned yet — browse and join the one you serve in.
                </p>
              )}
            </div>
            {pendingSubunitRequest && (
              <p className="text-xs text-[var(--warning)]">
                Your subunit change request is waiting for review.
              </p>
            )}
            {primary && (
              <p className="text-xs text-[var(--text-muted)]">
                In the wrong unit? You can request a move from the subunits page.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center justify-center p-6">
            <PerformanceRing value={composite} parts={parts} size={120} />
          </CardContent>
        </Card>
      </div>

      {/* General Training — department-wide, on every member's dashboard. */}
      {teachings.length > 0 && (
        <Card className="mt-4">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">General Training</CardTitle>
              <CardDescription>
                {teachingsDone} of {teachings.length} teachings listened
              </CardDescription>
            </div>
            <Link href="/training">
              <Button size="sm" variant={nextTeaching ? "default" : "outline"}>
                <Headphones className="h-4 w-4" />
                {nextTeaching ? "Continue" : "Review"}
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="h-2 overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all"
                style={{ width: `${trainingPercent}%` }}
              />
            </div>
            {nextTeaching ? (
              <Link
                href={`/training/${nextTeaching.id}`}
                className="flex items-center gap-2 text-sm text-[var(--accent)] hover:underline"
              >
                Up next: {nextTeaching.title}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <p className="text-sm text-[var(--success)]">
                You&apos;ve listened to everything. 🎉
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <h2 className="mb-3 mt-8 text-lg font-semibold">My courses</h2>
      {courses.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <GraduationCap className="h-8 w-8 text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">
              You&apos;re not enrolled in any courses yet. Courses appear here once your
              subunit leader publishes them.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <Link key={c.id} href={`/courses/${c.id}`}>
              <Card className="h-full transition-colors hover:border-[var(--accent)]">
                <CardHeader>
                  <CardTitle className="text-base">{c.title}</CardTitle>
                  {c.description && (
                    <CardDescription className="line-clamp-2">{c.description}</CardDescription>
                  )}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
