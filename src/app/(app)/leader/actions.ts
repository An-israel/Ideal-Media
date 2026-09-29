"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionRoles, type SessionRoles } from "@/lib/auth";
import { notify } from "@/lib/notify";

/**
 * Authorises the caller as a leader of the subunit that owns `courseId`.
 *
 * These actions previously did no authorization at all and leaned entirely on
 * RLS (AUDIT SEC-9). For `approveModule` that was exploitable: the RLS update
 * policy allowed `user_id = auth.uid()`, so a member could pass their own
 * progress id and approve their own assignment (AUDIT SEC-2). Migration 0011
 * closes the RLS side; this closes the action side.
 */
async function requireLeaderOfCourse(courseId: string): Promise<SessionRoles> {
  const session = await getSessionRoles();
  if (!session) throw new Error("Not authenticated");
  if (session.roles.includes("super_admin")) return session;

  // Admin client: a member cannot read a course they're not enrolled in, and we
  // need the subunit to answer the authorization question at all.
  const admin = createAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select("subunit_id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) throw new Error("Course not found.");

  if (!session.ledSubunitIds.includes(course.subunit_id)) {
    throw new Error("You don't lead the subunit that owns this course.");
  }
  return session;
}

/** Resolves a module_progress row to its course, then authorises. */
async function requireLeaderOfProgress(
  progressId: string
): Promise<{
  session: SessionRoles;
  userId: string;
  courseId: string;
  moduleTitle: string;
  rejectionCount: number;
}> {
  const admin = createAdminClient();
  const { data: progress } = await admin
    .from("module_progress")
    .select("user_id, module_id, rejection_count, modules(course_id, title)")
    .eq("id", progressId)
    .maybeSingle();
  if (!progress) throw new Error("Submission not found.");

  const mod = (progress as unknown as {
    modules: { course_id: string; title: string } | null;
  }).modules;
  if (!mod) throw new Error("Submission is not linked to a module.");

  const session = await requireLeaderOfCourse(mod.course_id);
  return {
    session,
    userId: progress.user_id,
    courseId: mod.course_id,
    moduleTitle: mod.title ?? "your assignment",
    rejectionCount: progress.rejection_count ?? 0,
  };
}

/** Leader approves a submitted assignment → next module unlocks (Section 7). */
export async function approveModule(progressId: string) {
  const { session, userId, courseId, moduleTitle } = await requireLeaderOfProgress(progressId);
  const supabase = await createClient();

  const { error } = await supabase
    .from("module_progress")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: session.userId,
      rejection_note: null,
    })
    .eq("id", progressId);
  if (error) throw new Error(error.message);

  await notify({
    userId,
    type: "assignment_approved",
    title: "Assignment approved",
    body: `Your submission for "${moduleTitle}" was approved.`,
    link: `/courses/${courseId}`,
  });

  revalidatePath("/leader/approvals");
  revalidatePath("/leader/members");
  revalidatePath(`/courses/${courseId}`);
  revalidatePath("/dashboard");
}

/** Leader rejects → member must redo and resubmit (Section 7). */
export async function rejectModule(progressId: string, note: string) {
  const { userId, courseId, moduleTitle, rejectionCount } =
    await requireLeaderOfProgress(progressId);
  const supabase = await createClient();

  const reason = note.trim() || "Please revise and resubmit.";
  const { error } = await supabase
    .from("module_progress")
    .update({
      status: "in_progress",
      rejection_note: reason,
      // Counted so the approval-rate metric reflects the real history
      // (AUDIT CRS-6). rejection_note is cleared on approval, so deriving the
      // rate from it gave anyone who was eventually approved a perfect score.
      rejection_count: rejectionCount + 1,
    })
    .eq("id", progressId);
  if (error) throw new Error(error.message);

  await notify({
    userId,
    type: "assignment_rejected",
    title: "Assignment needs redo",
    body: `"${moduleTitle}" needs changes: ${reason}`,
    link: `/courses/${courseId}`,
  });

  revalidatePath("/leader/approvals");
  revalidatePath(`/courses/${courseId}`);
  revalidatePath("/dashboard");
}

/** Leader approves/rejects a secondary-course application (Section 8). */
export async function decideApplication(enrollmentId: string, approve: boolean) {
  const admin = createAdminClient();
  const { data: enrollment } = await admin
    .from("enrollments")
    .select("user_id, course_id, status, courses(title)")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (!enrollment) throw new Error("Application not found.");

  const session = await requireLeaderOfCourse(enrollment.course_id);

  if (enrollment.status !== "pending_application") {
    throw new Error("That application has already been decided.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("enrollments")
    .update({
      status: approve ? "enrolled" : "rejected",
      decided_by: session.userId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", enrollmentId);
  if (error) throw new Error(error.message);

  const courseTitle =
    (enrollment as unknown as { courses: { title: string } | null }).courses?.title ??
    "the course";

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
  revalidatePath("/courses");
  revalidatePath("/dashboard");
}
