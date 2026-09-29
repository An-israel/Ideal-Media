import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCourseInstructor } from "@/lib/course-access";
import { CourseEditor, type EditorModule } from "./course-editor";

export default async function EditCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const supabase = await createClient();

  const { data: course } = await supabase
    .from("courses")
    .select("id, title, description, is_published, subunit_id, instructor_id")
    .eq("id", courseId)
    .single();
  if (!course) notFound();

  const admin = createAdminClient();

  // Who can teach this course: leaders of its subunit, plus any super admin.
  // Read on the admin client because a leader cannot read another leader's
  // profile row under RLS.
  const [instructor, { data: subunitLeaders }, { data: superAdmins }] = await Promise.all([
    resolveCourseInstructor(courseId),
    admin
      .from("subunit_members")
      .select("user_id, profiles(full_name, whatsapp_number)")
      .eq("subunit_id", course.subunit_id)
      .eq("role_in_subunit", "leader"),
    admin.from("user_roles").select("user_id, profiles(full_name, whatsapp_number)").eq("role", "super_admin"),
  ]);

  type CandidateRow = {
    user_id: string;
    profiles: { full_name: string; whatsapp_number: string | null } | null;
  };
  const candidateMap = new Map<string, { id: string; name: string; hasWhatsApp: boolean }>();
  for (const row of [
    ...((subunitLeaders ?? []) as unknown as CandidateRow[]),
    ...((superAdmins ?? []) as unknown as CandidateRow[]),
  ]) {
    if (!row.profiles) continue;
    candidateMap.set(row.user_id, {
      id: row.user_id,
      name: row.profiles.full_name,
      hasWhatsApp: !!row.profiles.whatsapp_number,
    });
  }
  const instructorOptions = [...candidateMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  // Fall back to a query without content_urls if that column's migration
  // hasn't been run yet — the editor must never show an empty course.
  let { data: modules } = await supabase
    .from("modules")
    .select("id, position, title, content_type, content_url, content_urls, content_body, assignments(instructions)")
    .eq("course_id", courseId)
    .order("position", { ascending: true });
  if (!modules) {
    const fallback = await supabase
      .from("modules")
      .select("id, position, title, content_type, content_url, content_body, assignments(instructions)")
      .eq("course_id", courseId)
      .order("position", { ascending: true });
    modules = fallback.data as unknown as typeof modules;
  }

  type Row = {
    id: string;
    position: number;
    title: string;
    content_type: EditorModule["content_type"];
    content_url: string | null;
    content_urls: string[] | null;
    content_body: string | null;
    // PostgREST returns a to-one embed (assignments.module_id is unique) as an
    // object, but older/array shapes are possible — handle both.
    assignments: { instructions: string } | { instructions: string }[] | null;
  };
  const firstAssignment = (a: Row["assignments"]) =>
    (Array.isArray(a) ? a[0] : a)?.instructions ?? "";
  const editorModules: EditorModule[] = ((modules ?? []) as unknown as Row[]).map((m) => {
    const urls = m.content_urls && m.content_urls.length > 0
      ? m.content_urls
      : m.content_url
        ? [m.content_url]
        : [];
    return {
      id: m.id,
      position: m.position,
      title: m.title,
      content_type: m.content_type,
      content_urls: urls.length > 0 ? urls : [""],
      content_body: m.content_body ?? "",
      instructions: firstAssignment(m.assignments),
    };
  });

  return (
    <CourseEditor
      courseId={course.id}
      initialTitle={course.title}
      initialDescription={course.description ?? ""}
      isPublished={course.is_published}
      modules={editorModules}
      instructorId={course.instructor_id}
      instructorName={instructor?.full_name ?? null}
      instructorReachable={instructor?.reachableOnWhatsApp ?? false}
      instructorOptions={instructorOptions}
    />
  );
}
