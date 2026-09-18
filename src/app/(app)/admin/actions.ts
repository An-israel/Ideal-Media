"use server";

import { revalidatePath } from "next/cache";
import { getSessionRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { syncWelfareForStatus } from "@/app/(app)/secretary/roster/actions";
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
  const session = await requireSuperAdmin();
  const admin = createAdminClient();

  // Never allow the organisation to be locked out of /admin (AUDIT SEC-8).
  // Revoking your own last super_admin role was a single click that could only
  // be undone with direct SQL in the Supabase console.
  if (role === "super_admin") {
    const { count } = await admin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "super_admin");
    if ((count ?? 0) <= 1) {
      throw new Error(
        "This is the only super admin account. Grant super admin to someone else before revoking it."
      );
    }
    if (userId === session.userId) {
      throw new Error(
        "You can't revoke your own super admin role. Ask another super admin to do it."
      );
    }
  }

  const { error } = await admin.from("user_roles").delete().eq("user_id", userId).eq("role", role);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/roles");
}

/**
 * Make (or unmake) a member the leader of a subunit; create membership if absent.
 *
 * Also grants/revokes the `subunit_leader` role (AUDIT ADM-2 / AUTH-7).
 * Leadership is read from two places — `subunit_members.role_in_subunit` for
 * data access, and the `subunit_leader` role for the `/leader` route gate — and
 * this only ever set the first. So an admin could make someone a leader and
 * they'd still be bounced off /leader to /dashboard.
 */
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

  // Keep the route-gating role in step with the membership flag.
  const { data: stillLeads } = await admin
    .from("subunit_members")
    .select("id")
    .eq("user_id", userId)
    .eq("role_in_subunit", "leader")
    .limit(1);

  if ((stillLeads ?? []).length > 0) {
    await admin
      .from("user_roles")
      .upsert(
        { user_id: userId, role: "subunit_leader" },
        { onConflict: "user_id,role", ignoreDuplicates: true }
      );
  } else {
    await admin
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role", "subunit_leader");
  }

  revalidatePath("/admin/roles");
  revalidatePath("/leader");
}

// ------------------------------------------------------------- Subunits ----
function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Builds a unique, non-empty slug (AUDIT ADM-6). A name of only punctuation
 * used to yield "", and two names differing only in punctuation collided on the
 * unique index — either way the raw Postgres error hit the admin UI.
 */
async function uniqueSlug(
  admin: ReturnType<typeof createAdminClient>,
  name: string,
  excludeId?: string
): Promise<string> {
  const base = slugify(name) || "subunit";
  const { data: taken } = await admin.from("subunits").select("id, slug");
  const used = new Set(
    (taken ?? []).filter((s) => s.id !== excludeId).map((s) => s.slug)
  );
  if (!used.has(base)) return base;
  for (let n = 2; n < 500; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export async function createSubunit(name: string, category: SubunitCategory) {
  await requireSuperAdmin();
  if (!name.trim()) throw new Error("A subunit needs a name.");
  const admin = createAdminClient();
  const { error } = await admin
    .from("subunits")
    .insert({ name: name.trim(), slug: await uniqueSlug(admin, name), category });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/subunits");
}

export async function updateSubunit(id: string, name: string, category: SubunitCategory) {
  await requireSuperAdmin();
  if (!name.trim()) throw new Error("A subunit needs a name.");
  const admin = createAdminClient();
  // The slug is refreshed with the name (AUDIT ADM-4). It used to be left
  // behind, and since the member import matches on BOTH name and slug, a
  // renamed subunit kept matching its old name indefinitely.
  const { error } = await admin
    .from("subunits")
    .update({ name: name.trim(), category, slug: await uniqueSlug(admin, name, id) })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/subunits");
}

/**
 * Deletes a subunit (AUDIT ADM-5). There was no delete or archive at all, so a
 * mistyped subunit was permanent. Refuses while anyone is still a member, since
 * the FK cascades and would silently drop their memberships and courses.
 */
export async function deleteSubunit(id: string) {
  await requireSuperAdmin();
  const admin = createAdminClient();

  const [{ count: memberCount }, { count: courseCount }] = await Promise.all([
    admin.from("subunit_members").select("id", { count: "exact", head: true }).eq("subunit_id", id),
    admin.from("courses").select("id", { count: "exact", head: true }).eq("subunit_id", id),
  ]);
  if ((memberCount ?? 0) > 0) {
    throw new Error(
      `${memberCount} member(s) still belong to this subunit. Move them first, then delete it.`
    );
  }
  if ((courseCount ?? 0) > 0) {
    throw new Error(
      `${courseCount} course(s) still belong to this subunit. Delete them first.`
    );
  }

  const { error } = await admin.from("subunits").delete().eq("id", id);
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
  if (!input.name.trim()) throw new Error("An activity needs a name.");
  const admin = createAdminClient();
  const { error } = await admin.from("activities").insert({
    name: input.name.trim(),
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
  if (!input.name.trim()) throw new Error("An activity needs a name.");
  const admin = createAdminClient();
  const { error } = await admin
    .from("activities")
    .update({
      name: input.name.trim(),
      day_of_week: input.day,
      time_of_day: input.time,
      is_attendance_signal: input.isSignal,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/activities");
}

/**
 * Deletes an activity (AUDIT ADM-5). Refuses once it has attendance history,
 * since attendance_records.activity_id has no ON DELETE and the history is the
 * whole point. Unset "attendance signal" to retire it instead.
 */
export async function deleteActivity(id: string) {
  await requireSuperAdmin();
  const admin = createAdminClient();

  const [{ count: recordCount }, { count: uploadCount }] = await Promise.all([
    admin.from("attendance_records").select("id", { count: "exact", head: true }).eq("activity_id", id),
    admin.from("attendance_uploads").select("id", { count: "exact", head: true }).eq("activity_id", id),
  ]);
  if ((recordCount ?? 0) > 0 || (uploadCount ?? 0) > 0) {
    throw new Error(
      `This activity has ${recordCount ?? 0} attendance record(s) and ${uploadCount ?? 0} upload(s), so it can't be deleted. Rename it, or turn off "attendance signal" to retire it.`
    );
  }

  const { error } = await admin.from("activities").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/activities");
}

/**
 * Sets the consecutive-missed-services threshold for a welfare flag.
 *
 * Validated (AUDIT WEL-1). This accepted any number, and 0 was catastrophic:
 * `[].every(...)` is `true`, so every active member got flagged on the next
 * attendance commit. The reader clamps too, belt and braces.
 */
export async function setMissedThreshold(value: number) {
  await requireSuperAdmin();
  const threshold = Math.floor(value);
  if (!Number.isFinite(threshold) || threshold < 1 || threshold > 52) {
    throw new Error("The threshold must be a whole number between 1 and 52.");
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("app_settings")
    .upsert(
      { key: "missed_service_threshold", value: threshold, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  if (error) throw new Error(error.message);
  revalidatePath("/admin/activities");
}

// ----------------------------------------------------- Code of conduct ----
/**
 * Publishes a new code-of-conduct version.
 *
 * Delegated to a DB function (AUDIT ADM-3 / AUTH-3) which does three things in
 * one transaction:
 *   - deactivates the current version and inserts the new one — previously two
 *     un-transacted statements against the `one_active_coc` unique index, so a
 *     failed insert left NO active version and broke the gate for everyone;
 *   - resets `coc_completed`, so a revised code is genuinely re-read and
 *     re-accepted. The versioning machinery existed but achieved nothing;
 *   - voids any quiz issued against the old version.
 */
export async function publishCocVersion(title: string, body: string) {
  await requireSuperAdmin();
  if (!title.trim()) throw new Error("The code of conduct needs a title.");
  if (!body.trim()) throw new Error("The code of conduct needs a body.");

  // Called on the RLS client so the function's is_super_admin() check sees the
  // caller rather than the service role.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("publish_coc_version", {
    p_title: title.trim(),
    p_body: body,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/coc");
  revalidatePath("/coc");
  return data as number;
}

export async function createQuestion(question: string, options: string[], correctIndex: number) {
  await requireSuperAdmin();
  const cleaned = options.map((o) => o.trim()).filter(Boolean);
  if (!question.trim()) throw new Error("A question needs text.");
  if (cleaned.length < 2) throw new Error("A question needs at least two options.");
  if (correctIndex < 0 || correctIndex >= cleaned.length) {
    throw new Error("Pick which option is correct.");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("coc_questions").insert({
    question: question.trim(),
    options: cleaned,
    correct_option_index: correctIndex,
    is_active: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/coc");
}

export async function toggleQuestion(id: string, isActive: boolean) {
  await requireSuperAdmin();
  const admin = createAdminClient();

  // The quiz needs enough active questions to fill an attempt.
  if (!isActive) {
    const { count } = await admin
      .from("coc_questions")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);
    if ((count ?? 0) <= 1) {
      throw new Error("At least one question must stay active, or the quiz can't run.");
    }
  }

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

  // Runs the same welfare sync as the secretary path (AUDIT ROS-4). This used
  // to skip it, so marking someone traveled opened a follow-up if a secretary
  // did it and silently did nothing if the super admin did.
  await syncWelfareForStatus([userId], status);

  revalidatePath("/admin/members");
  revalidatePath("/secretary/roster");
  revalidatePath("/welfare");
}
