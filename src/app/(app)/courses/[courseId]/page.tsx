import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { PhasePlaceholder } from "@/components/app/phase-placeholder";

export default async function CoursePlayerPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const supabase = await createClient();
  const { data: course } = await supabase
    .from("courses")
    .select("title, description")
    .eq("id", courseId)
    .single();

  return (
    <div>
      <PageHeader
        title={course?.title ?? "Course"}
        description={course?.description ?? undefined}
      />
      <PhasePlaceholder
        phase="Phase 3 — Course player"
        note="The module rail with sequential lock/check states, content rendering by type, the assignment, and the 'Submit to leader on WhatsApp' flow land here."
      />
    </div>
  );
}
