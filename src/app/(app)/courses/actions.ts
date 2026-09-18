"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCourseLeader } from "@/lib/course-access";
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
    .select("id, title, is_published, subunit_id, subunits(category)")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return { ok: false, error: "That course no longer exists." };
  if (!course.is_published) {
    return { ok: false, error: "That course isn't open for applications yet." };
  }

  const category = (course as unknown as { subunits: { category: string } | null }).subunits
    ?.category;
  if (category !== "secondary") {
    return {
      ok: false,
      error: "Primary-subunit courses are assigned automatically — there's nothing to apply for.",
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

  const [{ data: profile }, leader] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).single(),
    resolveCourseLeader(courseId),
  ]);

  if (leader) {
    await notify({
      userId: leader.id,
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
  /** Set when the leader has no usable WhatsApp number on file. */
  warning?: string;
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

  const leader = await resolveCourseLeader(mod.course_id);
  if (leader) {
    await notify({
      userId: leader.id,
      type: "assignment_submission",
      title: "New assignment submission",
      body: `${profile?.full_name ?? "A member"} submitted "${mod.title}" in ${courseTitle}.`,
      link: "/leader/approvals",
    });
  }

  let waLink: string | null = null;
  let warning: string | undefined;
  if (leader?.whatsapp_number) {
    const message =
      `Hello, this is ${profile?.full_name ?? "a member"} (${subunitName}). ` +
      `Submitting my assignment for review.\n` +
      `Course: ${courseTitle}\nModule ${mod.position}: ${mod.title}`;
    // Returns null when the stored number can't be made international — say so
    // instead of handing back a dead wa.me link (AUDIT CRS-3).
    waLink = buildWhatsAppLink(leader.whatsapp_number, message);
    if (!waLink) {
      warning = `Your leader's WhatsApp number (${leader.whatsapp_number}) isn't a valid number, so we couldn't open a chat. Your submission was recorded — please message them directly.`;
    }
  } else {
    warning =
      "Your leader hasn't added a WhatsApp number yet, so we couldn't open a chat. Your submission was recorded — please message them directly.";
  }

  revalidatePath(`/courses/${mod.course_id}`);
  revalidatePath("/dashboard");
  return { waLink, warning };
}
