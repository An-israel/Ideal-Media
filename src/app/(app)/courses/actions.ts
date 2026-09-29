"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCourseInstructor } from "@/lib/course-access";
import { notify } from "@/lib/notify";
import { buildWhatsAppLink } from "@/lib/phone";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, user };
}

export interface ApplyResult {
  ok: boolean;
  error?: string;
}

/** Member applies for a secondary-subunit course (Section 7). */
export async function applyForCourse(courseId: string, reason: string): Promise<ApplyResult> {
  const { supabase, user } = await requireUser();
  if (!reason.trim()) return { ok: false, error: "Please give a reason." };

  const admin = createAdminClient();

  const { data: course } = await admin
    .from("courses")
    .select("id, title, is_published, subunit_id, subunits(name)")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return { ok: false, error: "That course no longer exists." };
  if (!course.is_published) {
    return { ok: false, error: "That course isn't open for applications yet." };
  }

  // The member must belong to the course's subunit — join it first, then
  // request its courses. This used to be restricted to SECONDARY-category
  // subunits only, which meant someone who joined a primary subunit as an
  // additional member could see its courses on the browse page and had no way
  // to ask for them.
  const { data: membership } = await admin
    .from("subunit_members")
    .select("membership_type")
    .eq("user_id", user.id)
    .eq("subunit_id", course.subunit_id)
    .maybeSingle();
  if (!membership) {
    const subunitName =
      (course as unknown as { subunits: { name: string } | null }).subunits?.name ??
      "that subunit";
    return {
      ok: false,
      error: `Join ${subunitName} first, then you can request its courses.`,
    };
  }

  // Don't overwrite a decision that has already been made (AUDIT CRS-4). The
  // old blanket upsert let a rejected applicant re-apply immediately, wiping
  // `status: 'rejected'`, `decided_by` and `decided_at` — so the leader lost
  // the record that they had already said no.
  const { data: existing } = await admin
    .from("enrollments")
    .select("id, status")
    .eq("user_id", user.id)
    .eq("course_id", courseId)
    .maybeSingle();

  if (existing) {
    if (existing.status === "enrolled") {
      return { ok: false, error: "You're already enrolled in this course." };
    }
    if (existing.status === "pending_application") {
      return { ok: false, error: "Your application is already in — your leader will review it." };
    }
    return {
      ok: false,
      error: "Your previous application was declined. Please speak to your leader before re-applying.",
    };
  }

  const { error } = await supabase.from("enrollments").insert({
    user_id: user.id,
    course_id: courseId,
    status: "pending_application",
    application_reason: reason.trim(),
  });
  if (error) return { ok: false, error: error.message };

  const [{ data: profile }, instructor] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).single(),
    resolveCourseInstructor(courseId),
  ]);

  if (instructor) {
    await notify({
      userId: instructor.id,
      type: "course_application",
      title: "New course application",
      body: `${profile?.full_name ?? "A member"} applied for "${course.title}".`,
      link: "/leader/approvals",
    });
  }

  revalidatePath("/courses");
  revalidatePath("/dashboard");
  return { ok: true };
}

export interface SubmitResult {
  waLink: string | null;
  /** Set when the instructor has no usable WhatsApp number on file. */
  warning?: string;
  /** Who the submission is going to, for the confirmation message. */
  instructorName?: string;
}

/**
 * Submits a module's assignment (Section 7): marks it submitted, notifies the
 * leader, and returns a wa.me link the client opens so the actual work travels
 * over WhatsApp (the app never stores the file).
 *
 * Enrollment and sequential order are enforced HERE, not just in the player
 * (AUDIT CRS-1). The UI rendered locked modules as disabled buttons, but this
 * action accepted any module id from anyone — so modules could be submitted
 * out of order, or in a course the member wasn't enrolled in.
 */
export async function submitModule(moduleId: string): Promise<SubmitResult> {
  const { supabase, user } = await requireUser();
  const admin = createAdminClient();

  const { data: mod } = await admin
    .from("modules")
    .select("id, title, position, course_id, courses(title, subunit_id, subunits(name))")
    .eq("id", moduleId)
    .maybeSingle();
  if (!mod) throw new Error("Module not found");

  // Must be enrolled in the course.
  const { data: enrollment } = await admin
    .from("enrollments")
    .select("status")
    .eq("user_id", user.id)
    .eq("course_id", mod.course_id)
    .maybeSingle();
  if (!enrollment || enrollment.status !== "enrolled") {
    throw new Error("You're not enrolled in this course.");
  }

  // Every earlier module must be approved.
  const { data: earlier } = await admin
    .from("modules")
    .select("id")
    .eq("course_id", mod.course_id)
    .lt("position", mod.position);
  const earlierIds = (earlier ?? []).map((m) => m.id);

  if (earlierIds.length > 0) {
    const { data: progress } = await admin
      .from("module_progress")
      .select("module_id, status")
      .eq("user_id", user.id)
      .in("module_id", earlierIds);
    const approved = new Set(
      (progress ?? []).filter((p) => p.status === "approved").map((p) => p.module_id)
    );
    if (approved.size < earlierIds.length) {
      throw new Error(
        "Finish and get approval for the earlier modules before submitting this one."
      );
    }
  }

  // Don't clobber an approval by re-submitting.
  const { data: own } = await admin
    .from("module_progress")
    .select("status")
    .eq("user_id", user.id)
    .eq("module_id", moduleId)
    .maybeSingle();
  if (own?.status === "approved") throw new Error("This module is already approved.");

  const { error } = await supabase.from("module_progress").upsert(
    {
      user_id: user.id,
      module_id: moduleId,
      status: "submitted",
      submitted_at: new Date().toISOString(),
    },
    { onConflict: "user_id,module_id" }
  );
  if (error) throw new Error(error.message);

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  const courses = (mod as unknown as {
    courses: { title: string; subunits: { name: string } | null } | null;
  }).courses;
  const courseTitle = courses?.title ?? "course";
  const subunitName = courses?.subunits?.name ?? "";

  const instructor = await resolveCourseInstructor(mod.course_id);
  if (instructor) {
    await notify({
      userId: instructor.id,
      type: "assignment_submission",
      title: "New assignment submission",
      body: `${profile?.full_name ?? "A member"} submitted "${mod.title}" in ${courseTitle}.`,
      link: "/leader/approvals",
    });
  }

  let waLink: string | null = null;
  let warning: string | undefined;
  let instructorName: string | undefined;

  if (instructor) {
    instructorName = instructor.full_name;
    const message =
      `Hello ${instructor.full_name}, this is ${profile?.full_name ?? "a member"} (${subunitName}). ` +
      `Submitting my assignment for review.\n` +
      `Course: ${courseTitle}\nModule ${mod.position}: ${mod.title}`;
    // Null when the stored number can't be made international — say so instead
    // of handing back a dead wa.me link (AUDIT CRS-3).
    waLink = instructor.whatsapp_number
      ? buildWhatsAppLink(instructor.whatsapp_number, message)
      : null;
    if (!waLink) {
      warning =
        `${instructor.full_name} hasn't added a usable WhatsApp number yet, so we couldn't open a chat. ` +
        `Your submission was recorded and they've been notified in the app — please reach them directly.`;
      // Tell the instructor, since the member can't fix this themselves.
      await notify({
        userId: instructor.id,
        type: "whatsapp_number_missing",
        title: "Add your WhatsApp number",
        body: `${profile?.full_name ?? "A member"} tried to submit an assignment for "${courseTitle}" but couldn't reach you — your WhatsApp number is missing or invalid.`,
        link: "/profile",
      });
    }
  } else {
    warning =
      "This course has no instructor attached, so we couldn't open a chat. Your submission was recorded — please tell an admin.";
  }

  revalidatePath(`/courses/${mod.course_id}`);
  revalidatePath("/dashboard");
  return { waLink, warning, instructorName };
}
