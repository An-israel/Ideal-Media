"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionRoles, type SessionRoles } from "@/lib/auth";
import { autoEnrollPrimaryMembers, resolveCourseInstructor } from "@/lib/course-access";
import { notify } from "@/lib/notify";
import type { ContentType } from "@/lib/database.types";

async function requireLeaderOfSubunit(subunitId: string): Promise<SessionRoles> {
  const session = await getSessionRoles();
  if (!session) throw new Error("Not authenticated");
  const allowed =
    session.roles.includes("super_admin") || session.ledSubunitIds.includes(subunitId);
  if (!allowed) throw new Error("Not allowed for this subunit");
  return session;
}

/**
 * Authorises the caller as leader of the subunit that owns `courseId`.
 *
 * Only `createCourse` used to check anything — every other write here relied
 * entirely on RLS (AUDIT SEC-9). RLS did cover them, but it contradicted the
 * stated defense-in-depth model, and combined with the self-leadership hole
 * (AUDIT SEC-1) it meant any member could reach these.
 */
async function requireLeaderOfCourse(courseId: string): Promise<SessionRoles> {
  const admin = createAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select("subunit_id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) throw new Error("Course not found.");
  return requireLeaderOfSubunit(course.subunit_id);
}

/** Authorises via a module's parent course. */
async function requireLeaderOfModule(moduleId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: mod } = await admin
    .from("modules")
    .select("course_id")
    .eq("id", moduleId)
    .maybeSingle();
  if (!mod) throw new Error("Module not found.");
  await requireLeaderOfCourse(mod.course_id);
  return mod.course_id;
}

export async function createCourse(input: {
  subunitId: string;
  title: string;
  description: string;
}) {
  const session = await requireLeaderOfSubunit(input.subunitId);
  if (!input.title.trim()) throw new Error("A course needs a title.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("courses")
    .insert({
      subunit_id: input.subunitId,
      title: input.title.trim(),
      description: input.description || null,
      created_by: session.userId,
      // Whoever builds the course teaches it unless reassigned, so their name
      // shows on it and assignment submissions reach them.
      instructor_id: session.userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/leader/courses");
  return data.id;
}

export async function updateCourse(input: {
  courseId: string;
  title: string;
  description: string;
}) {
  await requireLeaderOfCourse(input.courseId);
  if (!input.title.trim()) throw new Error("A course needs a title.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("courses")
    .update({ title: input.title.trim(), description: input.description || null })
    .eq("id", input.courseId);
  if (error) throw new Error(error.message);
  revalidatePath("/leader/courses");
  revalidatePath(`/leader/courses/${input.courseId}`);
}

/**
 * Names the person who teaches a course and receives its submissions.
 *
 * Candidates are leaders of the course's subunit (plus a super admin), so a
 * course can be handed over when someone moves on without the submission route
 * silently pointing at the wrong person.
 */
export async function setCourseInstructor(courseId: string, instructorId: string) {
  await requireLeaderOfCourse(courseId);
  if (!instructorId) throw new Error("Pick an instructor.");

  const admin = createAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select("subunit_id, title, instructor_id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) throw new Error("Course not found.");
  if (course.instructor_id === instructorId) return;

  // The new instructor must actually be able to lead this subunit's work.
  const [{ data: membership }, { data: roles }] = await Promise.all([
    admin
      .from("subunit_members")
      .select("role_in_subunit")
      .eq("user_id", instructorId)
      .eq("subunit_id", course.subunit_id)
      .maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", instructorId),
  ]);
  const isSuperAdmin = (roles ?? []).some((r) => r.role === "super_admin");
  if (membership?.role_in_subunit !== "leader" && !isSuperAdmin) {
    throw new Error("An instructor must be a leader of this course's subunit.");
  }

  const { error } = await admin
    .from("courses")
    .update({ instructor_id: instructorId })
    .eq("id", courseId);
  if (error) throw new Error(error.message);

  await notify({
    userId: instructorId,
    type: "course_instructor_assigned",
    title: `You're now the instructor for "${course.title}"`,
    body: "Assignment submissions for this course will come to your WhatsApp. Check your number is on your profile.",
    link: "/profile",
  });

  revalidatePath("/leader/courses");
  revalidatePath(`/leader/courses/${courseId}`);
  revalidatePath("/courses");
  revalidatePath(`/courses/${courseId}`);
  revalidatePath("/dashboard");
}

export async function setPublished(courseId: string, publish: boolean) {
  await requireLeaderOfCourse(courseId);

  // A published course whose instructor has no usable WhatsApp number has no
  // working submission route at all — the member taps "Submit" and nothing
  // happens. Refuse, and say exactly who needs to do what.
  if (publish) {
    const instructor = await resolveCourseInstructor(courseId);
    if (!instructor) {
      throw new Error(
        "This course has no instructor attached. Set one before publishing."
      );
    }
    if (!instructor.reachableOnWhatsApp) {
      // Nudge them, since the person publishing often isn't the instructor.
      await notify({
        userId: instructor.id,
        type: "whatsapp_number_missing",
        title: "Add your WhatsApp number",
        body: "A course you teach can't be published until you add a valid WhatsApp number, because that's how members submit assignments to you.",
        link: "/profile",
      });
      throw new Error(
        `${instructor.full_name} has no valid WhatsApp number on their profile, so members would have no way to submit assignments. ` +
          `They've been asked to add one at My profile — publish once they have.`
      );
    }
  }

  const supabase = await createClient();

  const { data: course, error } = await supabase
    .from("courses")
    .update({ is_published: publish })
    .eq("id", courseId)
    .select("subunit_id, subunits(category)")
    .single();
  if (error) throw new Error(error.message);

  // Publishing a primary-subunit course auto-enrolls its primary members.
  const category = (course as unknown as { subunits: { category: string } | null }).subunits
    ?.category;
  if (publish && category === "primary") {
    await autoEnrollPrimaryMembers(courseId, course.subunit_id);
  }
  revalidatePath("/leader/courses");
  revalidatePath(`/leader/courses/${courseId}`);
  revalidatePath("/courses");
  revalidatePath("/dashboard");
}

export async function addModule(input: {
  courseId: string;
  title: string;
  contentType: ContentType;
  contentUrls: string[];
  contentBody: string;
  instructions: string;
}) {
  await requireLeaderOfCourse(input.courseId);
  if (!input.title.trim()) throw new Error("A module needs a title.");

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("modules")
    .select("position")
    .eq("course_id", input.courseId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (last?.position ?? 0) + 1;

  const urls = input.contentUrls.map((u) => u.trim()).filter(Boolean);
  let { data: mod, error } = await supabase
    .from("modules")
    .insert({
      course_id: input.courseId,
      position,
      title: input.title.trim(),
      content_type: input.contentType,
      content_url: urls[0] || null,
      content_urls: urls,
      content_body: input.contentBody || null,
    })
    .select("id")
    .single();
  // Retry without content_urls if that column's migration isn't run yet —
  // adding a module must never fail because of an optional feature.
  if (error && /content_urls/i.test(error.message)) {
    ({ data: mod, error } = await supabase
      .from("modules")
      .insert({
        course_id: input.courseId,
        position,
        title: input.title,
        content_type: input.contentType,
        content_url: urls[0] || null,
        content_body: input.contentBody || null,
      })
      .select("id")
      .single());
  }
  if (error) throw new Error(error.message);
  if (!mod) throw new Error("Could not add module.");

  if (input.instructions.trim()) {
    const { error: aErr } = await supabase
      .from("assignments")
      .insert({ module_id: mod.id, instructions: input.instructions });
    if (aErr) throw new Error(aErr.message);
  }
  revalidatePath(`/leader/courses/${input.courseId}`);
  revalidatePath(`/courses/${input.courseId}`);
}

export async function updateModule(input: {
  moduleId: string;
  courseId: string;
  title: string;
  contentType: ContentType;
  contentUrls: string[];
  contentBody: string;
  instructions: string;
}) {
  await requireLeaderOfModule(input.moduleId);
  if (!input.title.trim()) throw new Error("A module needs a title.");

  const supabase = await createClient();
  const urls = input.contentUrls.map((u) => u.trim()).filter(Boolean);
  let { error } = await supabase
    .from("modules")
    .update({
      title: input.title.trim(),
      content_type: input.contentType,
      content_url: urls[0] || null,
      content_urls: urls,
      content_body: input.contentBody || null,
    })
    .eq("id", input.moduleId);
  // Retry without content_urls if that column's migration isn't run yet.
  if (error && /content_urls/i.test(error.message)) {
    ({ error } = await supabase
      .from("modules")
      .update({
        title: input.title,
        content_type: input.contentType,
        content_url: urls[0] || null,
        content_body: input.contentBody || null,
      })
      .eq("id", input.moduleId));
  }
  if (error) throw new Error(error.message);

  // One assignment per module. Remove it when cleared; otherwise upsert on the
  // unique module_id.
  if (input.instructions.trim()) {
    const { error: aErr } = await supabase
      .from("assignments")
      .upsert(
        { module_id: input.moduleId, instructions: input.instructions },
        { onConflict: "module_id" }
      );
    if (aErr) throw new Error(aErr.message);
  } else {
    await supabase.from("assignments").delete().eq("module_id", input.moduleId);
  }
  revalidatePath(`/leader/courses/${input.courseId}`);
  revalidatePath(`/courses/${input.courseId}`);
}

export async function deleteModule(moduleId: string, courseId: string) {
  await requireLeaderOfModule(moduleId);
  const supabase = await createClient();
  const { error } = await supabase.from("modules").delete().eq("id", moduleId);
  if (error) throw new Error(error.message);
  revalidatePath(`/leader/courses/${courseId}`);
  revalidatePath(`/courses/${courseId}`);
}

/**
 * Swaps a module's position with its neighbour (reorder up/down).
 *
 * Delegated to a DB function so the swap is atomic (AUDIT CRS-2). Doing it as
 * three separate updates from here could leave a module stranded at the
 * temporary position of -1, which sorts ahead of module 1 and blocks every
 * later reorder on the unique (course_id, position) constraint.
 */
export async function moveModule(
  moduleId: string,
  courseId: string,
  direction: "up" | "down"
) {
  await requireLeaderOfModule(moduleId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_module", {
    p_module_id: moduleId,
    p_direction: direction,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/leader/courses/${courseId}`);
  revalidatePath(`/courses/${courseId}`);
}
