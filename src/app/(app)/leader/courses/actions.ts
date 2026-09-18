"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionRoles, type SessionRoles } from "@/lib/auth";
import { autoEnrollPrimaryMembers } from "@/lib/course-access";
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

export async function setPublished(courseId: string, publish: boolean) {
  await requireLeaderOfCourse(courseId);
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
  const { data: mod, error } = await supabase
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
  if (error) throw new Error(error.message);

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
  const { error } = await supabase
    .from("modules")
    .update({
      title: input.title.trim(),
      content_type: input.contentType,
      content_url: urls[0] || null,
      content_urls: urls,
      content_body: input.contentBody || null,
    })
    .eq("id", input.moduleId);
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
