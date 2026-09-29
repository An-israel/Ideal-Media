import { redirect } from "next/navigation";
import { MessageCircle, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { resolveCourseInstructor } from "@/lib/course-access";
import { getSessionRoles } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CoursePlayer, type PlayerModule } from "./course-player";
import type { ContentType, ModuleProgressStatus } from "@/lib/database.types";

export default async function CoursePlayerPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const session = await getSessionRoles();
  if (!session) redirect("/login");
  const supabase = await createClient();

  const { data: course } = await supabase
    .from("courses")
    .select("id, title, description")
    .eq("id", courseId)
    .single();
  if (!course) redirect("/courses");

  const [{ data: enrollment }, instructor] = await Promise.all([
    supabase
      .from("enrollments")
      .select("status")
      .eq("course_id", courseId)
      .eq("user_id", session.userId)
      .maybeSingle(),
    // Who this course belongs to, and whether the submit-on-WhatsApp handoff
    // will actually work — so the member knows before they finish a module.
    resolveCourseInstructor(courseId),
  ]);

  const [modulesRes, { data: progress }] = await Promise.all([
    supabase
      .from("modules")
      .select("id, position, title, content_type, content_url, content_urls, content_body, assignments(instructions)")
      .eq("course_id", courseId)
      .order("position", { ascending: true }),
    supabase
      .from("module_progress")
      .select("module_id, status, rejection_note")
      .eq("user_id", session.userId),
  ]);
  let modules = modulesRes.data;
  // Fall back without content_urls if that column's migration isn't run yet.
  if (!modules) {
    const fallback = await supabase
      .from("modules")
      .select("id, position, title, content_type, content_url, content_body, assignments(instructions)")
      .eq("course_id", courseId)
      .order("position", { ascending: true });
    modules = fallback.data as unknown as typeof modules;
  }

  if (enrollment?.status !== "enrolled") {
    return (
      <div>
        <PageHeader title={course.title} description={course.description ?? undefined} />
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--text-muted)]">
            {enrollment?.status === "pending_application"
              ? "Your application for this course is pending review."
              : "You're not enrolled in this course."}
          </CardContent>
        </Card>
      </div>
    );
  }

  const progressMap = new Map(
    (progress ?? []).map((p) => [p.module_id, p])
  );

  type Row = {
    id: string;
    position: number;
    title: string;
    content_type: ContentType;
    content_url: string | null;
    content_urls: string[] | null;
    content_body: string | null;
    // To-one embed: PostgREST returns an object (module_id is unique), not an array.
    assignments: { instructions: string } | { instructions: string }[] | null;
  };
  const rows = (modules ?? []) as unknown as Row[];
  const firstInstructions = (a: Row["assignments"]) =>
    (Array.isArray(a) ? a[0] : a)?.instructions ?? null;

  const playerModules: PlayerModule[] = rows.map((m, i) => {
    const prev = i > 0 ? rows[i - 1] : null;
    const prevStatus = prev ? progressMap.get(prev.id)?.status : undefined;
    const locked = i > 0 && prevStatus !== "approved";
    const p = progressMap.get(m.id);
    const urls = m.content_urls && m.content_urls.length > 0
      ? m.content_urls
      : m.content_url
        ? [m.content_url]
        : [];
    return {
      id: m.id,
      position: m.position,
      title: m.title,
      contentType: m.content_type,
      contentUrls: urls,
      contentBody: m.content_body,
      instructions: firstInstructions(m.assignments),
      status: (p?.status ?? "not_started") as ModuleProgressStatus,
      rejectionNote: p?.rejection_note ?? null,
      locked,
    };
  });

  return (
    <div>
      <PageHeader title={course.title} description={course.description ?? undefined} />

      {instructor && (
        <Card className="mb-6">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4">
            <span className="flex items-center gap-2 text-sm">
              <UserRound className="h-4 w-4 text-[var(--text-muted)]" />
              Taught by <b>{instructor.full_name}</b>
            </span>
            {instructor.reachableOnWhatsApp ? (
              <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <MessageCircle className="h-3 w-3" />
                Assignments are submitted to them on WhatsApp
              </span>
            ) : (
              <span className="text-xs text-[var(--warning)]">
                They haven&apos;t added a WhatsApp number yet, so submissions will be recorded
                in-app only.
              </span>
            )}
          </CardContent>
        </Card>
      )}

      <CoursePlayer modules={playerModules} />
    </div>
  );
}
