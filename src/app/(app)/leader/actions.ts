"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionRoles } from "@/lib/auth";
import { notify } from "@/lib/notify";

/** Leader approves a submitted assignment → next module unlocks (Section 7). */
export async function approveModule(progressId: string) {
  const supabase = await createClient();
  const session = await getSessionRoles();
  if (!session) throw new Error("Not authenticated");

  const { data: progress, error } = await supabase
    .from("module_progress")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: session.userId,
      rejection_note: null,
    })
    .eq("id", progressId)
    .select("user_id, module_id, modules(title, course_id)")
    .single();
  if (error) throw new Error(error.message);

  // @ts-expect-error supabase embed typing
  const courseId: string = progress.modules?.course_id;
  // @ts-expect-error supabase embed typing
  const moduleTitle: string = progress.modules?.title ?? "your assignment";

  await notify({
    userId: progress.user_id,
    type: "assignment_approved",
    title: "Assignment approved",
    body: `Your submission for "${moduleTitle}" was approved.`,
    link: `/courses/${courseId}`,
  });
  revalidatePath("/leader/approvals");
}

/** Leader rejects → member must redo and resubmit (Section 7). */
export async function rejectModule(progressId: string, note: string) {
  const supabase = await createClient();

  const { data: progress, error } = await supabase
    .from("module_progress")
    .update({ status: "in_progress", rejection_note: note || "Please revise and resubmit." })
    .eq("id", progressId)
    .select("user_id, module_id, modules(title, course_id)")
    .single();
  if (error) throw new Error(error.message);

  // @ts-expect-error supabase embed typing
  const courseId: string = progress.modules?.course_id;
  // @ts-expect-error supabase embed typing
  const moduleTitle: string = progress.modules?.title ?? "your assignment";

  await notify({
    userId: progress.user_id,
    type: "assignment_rejected",
    title: "Assignment needs redo",
    body: `"${moduleTitle}" needs changes: ${note}`,
    link: `/courses/${courseId}`,
  });
  revalidatePath("/leader/approvals");
}

/** Leader approves/rejects a secondary-course application (Section 8). */
export async function decideApplication(enrollmentId: string, approve: boolean) {
  const supabase = await createClient();
  const session = await getSessionRoles();
  if (!session) throw new Error("Not authenticated");

  const { data: enrollment, error } = await supabase
    .from("enrollments")
    .update({
      status: approve ? "enrolled" : "rejected",
      decided_by: session.userId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", enrollmentId)
    .select("user_id, course_id, courses(title)")
    .single();
  if (error) throw new Error(error.message);

  // @ts-expect-error supabase embed typing
  const courseTitle: string = enrollment.courses?.title ?? "the course";
  await notify({
    userId: enrollment.user_id,
    type: approve ? "application_approved" : "application_rejected",
    title: approve ? "Course application approved" : "Course application declined",
    body: approve
      ? `You're now enrolled in "${courseTitle}".`
      : `Your application for "${courseTitle}" was declined.`,
    link: approve ? `/courses/${enrollment.course_id}` : "/courses",
  });
  revalidatePath("/leader/approvals");
}
