"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionRoles } from "@/lib/auth";
import { autoEnrollPrimaryMembers } from "@/lib/course-access";
import type { ContentType } from "@/lib/database.types";

async function requireLeaderOfSubunit(subunitId: string) {
  const session = await getSessionRoles();
  if (!session) throw new Error("Not authenticated");
  const allowed =
    session.roles.includes("super_admin") || session.ledSubunitIds.includes(subunitId);
  if (!allowed) throw new Error("Not allowed for this subunit");
  return session;
}

export async function createCourse(input: {
  subunitId: string;
  title: string;
  description: string;
}) {
  const session = await requireLeaderOfSubunit(input.subunitId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("courses")
    .insert({
      subunit_id: input.subunitId,
      title: input.title,
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
  const supabase = await createClient();
  const { error } = await supabase
    .from("courses")
    .update({ title: input.title, description: input.description || null })
    .eq("id", input.courseId);
  if (error) throw new Error(error.message);
  revalidatePath(`/leader/courses/${input.courseId}`);
}

export async function setPublished(courseId: string, publish: boolean) {
  const supabase = await createClient();
  const { data: course, error } = await supabase
    .from("courses")
    .update({ is_published: publish })
    .eq("id", courseId)
    .select("subunit_id, subunits(category)")
    .single();
  if (error) throw new Error(error.message);

  // Publishing a primary-subunit course auto-enrolls its primary members.
  // @ts-expect-error supabase embed typing
  if (publish && course?.subunits?.category === "primary") {
    await autoEnrollPrimaryMembers(courseId, course.subunit_id);
  }
  revalidatePath("/leader/courses");
  revalidatePath(`/leader/courses/${courseId}`);
}

export async function addModule(input: {
  courseId: string;
  title: string;
  contentType: ContentType;
  contentUrls: string[];
  contentBody: string;
  instructions: string;
}) {
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
      title: input.title,
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
  const supabase = await createClient();
  const urls = input.contentUrls.map((u) => u.trim()).filter(Boolean);
  const { error } = await supabase
    .from("modules")
    .update({
      title: input.title,
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
}

export async function deleteModule(moduleId: string, courseId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("modules").delete().eq("id", moduleId);
  if (error) throw new Error(error.message);
  revalidatePath(`/leader/courses/${courseId}`);
}

/** Swaps a module's position with its neighbour (reorder up/down). */
export async function moveModule(
  moduleId: string,
  courseId: string,
  direction: "up" | "down"
) {
  const supabase = await createClient();
  const { data: mods } = await supabase
    .from("modules")
    .select("id, position")
    .eq("course_id", courseId)
    .order("position", { ascending: true });
  if (!mods) return;

  const idx = mods.findIndex((m) => m.id === moduleId);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= mods.length) return;

  const a = mods[idx];
  const b = mods[swapIdx];
  // Use a temporary position to avoid colliding with the unique constraint.
  await supabase.from("modules").update({ position: -1 }).eq("id", a.id);
  await supabase.from("modules").update({ position: a.position }).eq("id", b.id);
  await supabase.from("modules").update({ position: b.position }).eq("id", a.id);
  revalidatePath(`/leader/courses/${courseId}`);
}
