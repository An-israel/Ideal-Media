import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionRoles } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ApplyCourseButton } from "./apply-course-button";

export default async function CoursesPage() {
  const session = await getSessionRoles();
  if (!session) return null;
  const supabase = await createClient();

  // Member's enrollments (any status).
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("status, course_id, courses(id, title, description)")
    .eq("user_id", session.userId);

  type EnrollRow = {
    status: string;
    course_id: string;
    courses: { id: string; title: string; description: string | null } | null;
  };
  const enrollRows = ((enrollments ?? []) as unknown as EnrollRow[]).filter((r) => r.courses);
  const enrolledIds = new Set(enrollRows.map((r) => r.course_id));

  // Secondary subunits the member belongs to.
  const { data: secondaryMemberships } = await supabase
    .from("subunit_members")
    .select("subunit_id")
    .eq("user_id", session.userId)
    .eq("membership_type", "secondary");
  const secondarySubunitIds = (secondaryMemberships ?? []).map((m) => m.subunit_id);

  // Published courses in those secondary subunits the member could apply for.
  let availableRows: { id: string; title: string; description: string | null }[] = [];
  if (secondarySubunitIds.length) {
    const { data: available } = await supabase
      .from("courses")
      .select("id, title, description")
      .in("subunit_id", secondarySubunitIds)
      .eq("is_published", true);
    availableRows = (available ?? []).filter((c) => !enrolledIds.has(c.id));
  }

  return (
    <div>
      <PageHeader title="My Courses" description="Everything you're enrolled in or can apply for." />

      {enrollRows.length === 0 && availableRows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--text-muted)]">
            No courses yet. They appear here once your subunit leader publishes them.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {enrollRows.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {enrollRows.map((r) => {
                const card = (
                  <Card className="h-full transition-colors hover:border-[var(--accent)]">
                    <CardHeader>
                      <div className="mb-2 flex items-center gap-2">
                        {r.status === "enrolled" && <Badge variant="success">Enrolled</Badge>}
                        {r.status === "pending_application" && <Badge variant="warning">Pending review</Badge>}
                        {r.status === "rejected" && <Badge variant="danger">Rejected</Badge>}
                      </div>
                      <CardTitle className="text-base">{r.courses!.title}</CardTitle>
                      {r.courses!.description && (
                        <CardDescription className="line-clamp-2">{r.courses!.description}</CardDescription>
                      )}
                    </CardHeader>
                  </Card>
                );
                return r.status === "enrolled" ? (
                  <Link key={r.course_id} href={`/courses/${r.courses!.id}`}>{card}</Link>
                ) : (
                  <div key={r.course_id}>{card}</div>
                );
              })}
            </div>
          )}

          {availableRows.length > 0 && (
            <div>
              <h2 className="mb-3 text-lg font-semibold">Available to apply</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {availableRows.map((c) => (
                  <Card key={c.id} className="flex h-full flex-col">
                    <CardHeader className="flex-1">
                      <div className="mb-2">
                        <Badge variant="neutral">Locked</Badge>
                      </div>
                      <CardTitle className="text-base">{c.title}</CardTitle>
                      {c.description && (
                        <CardDescription className="line-clamp-2">{c.description}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent>
                      <ApplyCourseButton courseId={c.id} courseTitle={c.title} />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
