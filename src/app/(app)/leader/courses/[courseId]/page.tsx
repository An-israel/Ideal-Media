import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
    .select("id, title, description, is_published")
    .eq("id", courseId)
    .single();
  if (!course) notFound();

  const { data: modules } = await supabase
    .from("modules")
    .select("id, position, title, content_type, content_url, content_urls, content_body, assignments(instructions)")
    .eq("course_id", courseId)
    .order("position", { ascending: true });

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
    />
  );
}
