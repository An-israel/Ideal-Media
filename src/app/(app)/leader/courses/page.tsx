import Link from "next/link";
import { AlertTriangle, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSessionRoles } from "@/lib/auth";
import { getCourseInstructors } from "@/lib/course-access";
import { normalizePhone } from "@/lib/phone";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateCourseButton } from "./create-course-button";

export default async function LeaderCoursesPage() {
  const session = await getSessionRoles();
  if (!session) return null;
  const supabase = await createClient();

  const isAdmin = session.roles.includes("super_admin");
  const subunitFilter = isAdmin ? null : session.ledSubunitIds;

  let subunitQuery = supabase.from("subunits").select("id, name").order("name");
  if (subunitFilter) subunitQuery = subunitQuery.in("id", subunitFilter.length ? subunitFilter : ["00000000-0000-0000-0000-000000000000"]);
  const { data: ledSubunits } = await subunitQuery;

  const [{ data: courses }, { data: me }, instructors] = await Promise.all([
    supabase
      .from("courses")
      .select("id, title, is_published, instructor_id, subunits(name), modules(count)")
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("whatsapp_number").eq("id", session.userId).single(),
    getCourseInstructors(supabase),
  ]);

  type CourseRow = {
    id: string;
    title: string;
    is_published: boolean;
    instructor_id: string | null;
    subunits: { name: string } | null;
    modules: { count: number }[];
  };
  const rows = (courses ?? []) as unknown as CourseRow[];

  // The nudge: a course whose instructor can't be reached on WhatsApp has no
  // working submission route at all, and until now nothing told anyone.
  const myWhatsAppOk = normalizePhone(me?.whatsapp_number) !== null;
  const myCourses = rows.filter((c) => c.instructor_id === session.userId);
  const needsMyNumber = myCourses.length > 0 && !myWhatsAppOk;
  const othersMissing = rows.filter(
    (c) => c.instructor_id !== session.userId && !instructors.get(c.id)?.hasWhatsApp
  );

  return (
    <div>
      <PageHeader
        title="Courses"
        description="Build and publish courses for your subunit."
        action={<CreateCourseButton subunits={ledSubunits ?? []} />}
      />

      {needsMyNumber && (
        <Card className="mb-6 border-[var(--danger)]/40 bg-[var(--danger)]/5">
          <CardContent className="flex flex-wrap items-start justify-between gap-3 py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]" />
              <div>
                <p className="text-sm font-medium">Add your WhatsApp number</p>
                <p className="text-sm text-[var(--text-muted)]">
                  You teach {myCourses.length} course{myCourses.length === 1 ? "" : "s"}, and
                  members submit assignments by opening a WhatsApp chat with you. Without a valid
                  number that button can&apos;t reach you, and these courses can&apos;t be
                  published.
                </p>
              </div>
            </div>
            <Link href="/profile">
              <Button size="sm">Add it now</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {othersMissing.length > 0 && (
        <Card className="mb-6 border-[var(--warning)]/40 bg-[var(--warning)]/5">
          <CardContent className="py-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-[var(--warning)]" />
              {othersMissing.length} course{othersMissing.length === 1 ? "" : "s"} can&apos;t
              receive assignments
            </p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              The instructor has no valid WhatsApp number:{" "}
              {othersMissing
                .map(
                  (c) =>
                    `${c.title} (${instructors.get(c.id)?.instructorName ?? "no instructor set"})`
                )
                .join(", ")}
              . Ask them to add one under My profile.
            </p>
          </CardContent>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--text-muted)]">
            No courses yet. Create your first course to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => (
            <Link key={c.id} href={`/leader/courses/${c.id}`}>
              <Card className="h-full transition-colors hover:border-[var(--accent)]">
                <CardHeader>
                  <div className="mb-2 flex items-center gap-2">
                    {c.is_published ? (
                      <Badge variant="success">Published</Badge>
                    ) : (
                      <Badge variant="neutral">Draft</Badge>
                    )}
                    <span className="text-xs text-[var(--text-muted)]">
                      {c.modules?.[0]?.count ?? 0} modules
                    </span>
                  </div>
                  <CardTitle className="text-base">{c.title}</CardTitle>
                  <p className="text-sm text-[var(--text-muted)]">{c.subunits?.name}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                    <UserRound className="h-3 w-3" />
                    {instructors.get(c.id)?.instructorName ?? "No instructor set"}
                    {instructors.get(c.id)?.instructorName &&
                      !instructors.get(c.id)?.hasWhatsApp && (
                        <span className="text-[var(--danger)]">· no WhatsApp</span>
                      )}
                  </p>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
