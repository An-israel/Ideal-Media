"use server";

import { revalidatePath } from "next/cache";
import { getSessionRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Role, SubunitCategory, MemberStatus } from "@/lib/database.types";

async function requireSuperAdmin() {
  const session = await getSessionRoles();
  if (!session || !session.roles.includes("super_admin")) {
    throw new Error("Super admin access required");
  }
  return session;
}

// ---------------------------------------------------------------- Roles ----
export async function grantRole(userId: string, role: Role) {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .from("user_roles")
    .upsert({ user_id: userId, role }, { onConflict: "user_id,role", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/roles");
}

export async function revokeRole(userId: string, role: Role) {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const { error } = await admin.from("user_roles").delete().eq("user_id", userId).eq("role", role);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/roles");
}

/** Make (or unmake) a member the leader of a subunit; create membership if absent. */
export async function setSubunitLeader(userId: string, subunitId: string, isLeader: boolean) {
  await requireSuperAdmin();
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("subunit_members")
    .select("id, membership_type")
    .eq("user_id", userId)
    .eq("subunit_id", subunitId)
    .maybeSingle();

  if (existing) {
    const { error } = await admin
      .from("subunit_members")
      .update({ role_in_subunit: isLeader ? "leader" : "member" })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else if (isLeader) {
    // Add them to the subunit as a secondary member + leader.
    const { error } = await admin.from("subunit_members").insert({
      user_id: userId,
      subunit_id: subunitId,
      membership_type: "secondary",
      role_in_subunit: "leader",
    });
    if (error) throw new Error(error.message);
  }
  revalidatePath("/admin/roles");
}

// ------------------------------------------------------------- Subunits ----
function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function createSubunit(name: string, category: SubunitCategory) {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .from("subunits")
    .insert({ name, slug: slugify(name), category });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/subunits");
}

export async function updateSubunit(id: string, name: string, category: SubunitCategory) {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const { error } = await admin.from("subunits").update({ name, category }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/subunits");
}

// ------------------------------------------------------------ Activities ----
export async function createActivity(input: {
  name: string;
  day: string;
  time: string;
  isSignal: boolean;
}) {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const { error } = await admin.from("activities").insert({
    name: input.name,
    day_of_week: input.day,
    time_of_day: input.time,
    is_attendance_signal: input.isSignal,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/activities");
}

export async function updateActivity(
  id: string,
  input: { name: string; day: string; time: string; isSignal: boolean }
) {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .from("activities")
    .update({
      name: input.name,
      day_of_week: input.day,
      time_of_day: input.time,
      is_attendance_signal: input.isSignal,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/activities");
}

export async function setMissedThreshold(value: number) {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .from("app_settings")
    .upsert({ key: "missed_service_threshold", value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/activities");
}

// ----------------------------------------------------- Code of conduct ----
export async function publishCocVersion(title: string, body: string) {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const { data: latest } = await admin
    .from("code_of_conduct")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (latest?.version ?? 0) + 1;

  // Only one active version at a time.
  await admin.from("code_of_conduct").update({ is_active: false }).eq("is_active", true);
  const { error } = await admin
    .from("code_of_conduct")
    .insert({ version: nextVersion, title, body, is_active: true });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/coc");
}

export async function createQuestion(question: string, options: string[], correctIndex: number) {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const { error } = await admin.from("coc_questions").insert({
    question,
    options,
    correct_option_index: correctIndex,
    is_active: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/coc");
}

export async function toggleQuestion(id: string, isActive: boolean) {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const { error } = await admin.from("coc_questions").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/coc");
}

export async function deleteQuestion(id: string) {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const { error } = await admin.from("coc_questions").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/coc");
}

// -------------------------------------------------------------- Members ----
export async function adminSetMemberStatus(userId: string, status: MemberStatus) {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ member_status: status }).eq("id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/members");
}
