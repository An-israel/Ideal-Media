import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionRoles } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PhasePlaceholder } from "@/components/app/phase-placeholder";

export default async function CoursesPage() {
  const session = await getSessionRoles();
  if (!session) return null;
  const supabase = await createClient();

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("status, courses(id, title, description)")
    .eq("user_id", session.userId);

  type Row = {
    status: string;
    courses: { id: string; title: string; description: string | null } | null;
  };
  const rows = ((enrollments ?? []) as unknown as Row[]).filter((r) => r.courses);

  return (
    <div>
      <PageHeader title="My Courses" description="Everything you're enrolled in or have applied for." />
      {rows.length === 0 ? (
        <PhasePlaceholder
          phase="Phase 3 — Courses"
          note="The course player (sequential module gating, WhatsApp submission) and secondary-course applications land here. Once leaders publish courses for your subunit, they show up automatically."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <Link key={r.courses!.id} href={`/courses/${r.courses!.id}`}>
              <Card className="h-full transition-colors hover:border-[var(--accent)]">
                <CardHeader>
                  <div className="mb-2 flex items-center gap-2">
                    {r.status === "enrolled" && <Badge variant="success">Enrolled</Badge>}
                    {r.status === "pending_application" && (
                      <Badge variant="warning">Pending review</Badge>
                    )}
                    {r.status === "rejected" && <Badge variant="danger">Rejected</Badge>}
                  </div>
                  <CardTitle className="text-base">{r.courses!.title}</CardTitle>
                  {r.courses!.description && (
                    <CardDescription className="line-clamp-2">
                      {r.courses!.description}
                    </CardDescription>
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
