import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionRoles } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
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

  const { data: courses } = await supabase
    .from("courses")
    .select("id, title, is_published, subunits(name), modules(count)")
    .order("created_at", { ascending: false });

  type CourseRow = {
    id: string;
    title: string;
    is_published: boolean;
    subunits: { name: string } | null;
    modules: { count: number }[];
  };
  const rows = (courses ?? []) as unknown as CourseRow[];

  return (
    <div>
      <PageHeader
        title="Courses"
        description="Build and publish courses for your subunit."
        action={<CreateCourseButton subunits={ledSubunits ?? []} />}
      />
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
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
