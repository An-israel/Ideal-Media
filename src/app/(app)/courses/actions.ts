"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveCourseLeader } from "@/lib/course-access";
import { notify } from "@/lib/notify";
import { buildWhatsAppLink } from "@/lib/utils";

/** Member applies for a secondary-subunit course (Section 7). */
export async function applyForCourse(courseId: string, reason: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  if (!reason.trim()) throw new Error("Please give a reason.");

  const { error } = await supabase.from("enrollments").upsert(
    {
      user_id: user.id,
      course_id: courseId,
      status: "pending_application",
      application_reason: reason,
    },
    { onConflict: "user_id,course_id" }
  );
  if (error) throw new Error(error.message);

  const [{ data: profile }, leader, { data: course }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).single(),
    resolveCourseLeader(courseId),
    supabase.from("courses").select("title").eq("id", courseId).single(),
  ]);
  if (leader) {
    await notify({
      userId: leader.id,
      type: "course_application",
      title: "New course application",
      body: `${profile?.full_name ?? "A member"} applied for "${course?.title ?? "a course"}".`,
      link: "/leader/approvals",
    });
  }
  revalidatePath("/courses");
  revalidatePath("/dashboard");
}

export interface SubmitResult {
  waLink: string | null;
}

/**
 * Submits a module's assignment (Section 7): marks it submitted, notifies the
 * leader, and returns a wa.me link the client opens so the actual work travels
 * over WhatsApp (the app never stores the file).
 */
export async function submitModule(moduleId: string): Promise<SubmitResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: mod } = await supabase
    .from("modules")
    .select("title, position, course_id, courses(title, subunit_id, subunits(name))")
    .eq("id", moduleId)
    .single();
  if (!mod) throw new Error("Module not found");

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

  // @ts-expect-error supabase embed typing
  const courseTitle: string = mod.courses?.title ?? "course";
  // @ts-expect-error supabase embed typing
  const subunitName: string = mod.courses?.subunits?.name ?? "";

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
  if (leader?.whatsapp_number) {
    const message =
      `Hello, this is ${profile?.full_name ?? "a member"} (${subunitName}). ` +
      `Submitting my assignment for review.\n` +
      `Course: ${courseTitle}\nModule ${mod.position}: ${mod.title}`;
    waLink = buildWhatsAppLink(leader.whatsapp_number, message);
  }

  revalidatePath(`/courses/${mod.course_id}`);
  return { waLink };
}
