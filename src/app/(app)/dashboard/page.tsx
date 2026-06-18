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
import { GraduationCap } from "lucide-react";

export default async function DashboardPage() {
  const session = await getSessionRoles();
  if (!session) return null;
  const supabase = await createClient();

  const [{ data: memberships }, { parts, composite }, { data: enrollments }] =
    await Promise.all([
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
    ]);

  const primary = (memberships ?? []).find((m) => m.membership_type === "primary");
  const secondaries = (memberships ?? []).filter((m) => m.membership_type === "secondary");

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
          <CardHeader>
            <CardTitle className="text-base">Your subunits</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {primary && (
              // @ts-expect-error supabase embed typing
              <Badge>{primary.subunits?.name} · Primary</Badge>
            )}
            {secondaries.map((s, i) => (
              // @ts-expect-error supabase embed typing
              <Badge key={i} variant="neutral">{s.subunits?.name}</Badge>
            ))}
            {!primary && secondaries.length === 0 && (
              <p className="text-sm text-[var(--text-muted)]">No subunits assigned yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center justify-center p-6">
            <PerformanceRing value={composite} parts={parts} size={120} />
          </CardContent>
        </Card>
      </div>

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
