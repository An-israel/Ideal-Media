"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionRoles } from "@/lib/auth";
import { notifyRole } from "@/lib/notify";
import { createUnclaimedMember } from "@/lib/member-admin";
import { resolveAutoFollowups } from "@/lib/welfare-automation";
import { MAX_SUBUNITS_PER_MEMBER } from "@/lib/constants";
import type { MemberStatus } from "@/lib/database.types";

async function requireSecretary() {
  const session = await getSessionRoles();
  if (!session) throw new Error("Not authenticated");
  if (!session.roles.includes("secretary") && !session.roles.includes("super_admin")) {
    throw new Error("Secretary access required");
  }
  return session;
}

export async function setMemberStatus(userIds: string[], status: MemberStatus) {
  await requireSecretary();
  if (userIds.length === 0) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ member_status: status })
    .in("id", userIds);
  if (error) throw new Error(error.message);

  // Marking someone traveled/inactive opens a welfare follow-up and notifies
  // the welfare team so they know to check in. Returning to active resolves it.
  // Best-effort: the status change itself must never fail because of this.
  try {
    await syncWelfareForStatus(userIds, status);
  } catch {
    /* noop */
  }

  revalidatePath("/secretary/roster");
  revalidatePath("/secretary");
  revalidatePath("/welfare");
  revalidatePath("/admin/members");
}

/**
 * Keeps the welfare board in step with a member's status.
 *
 * Exported so the super-admin path uses the same logic (AUDIT ROS-4) — that
 * path skipped this entirely, so marking someone traveled opened a follow-up
 * if a secretary did it and silently did nothing if the super admin did.
 */
export async function syncWelfareForStatus(userIds: string[], status: MemberStatus) {
  const admin = createAdminClient();

  if (status === "traveled" || status === "inactive") {
    const reason = status;
    // Try to open follow-ups on the welfare board. If the database doesn't
    // know this reason yet (setup SQL not run), fall back to notifying about
    // everyone — welfare must still hear about it either way.
    let toFlag = userIds;
    try {
      const { data: existing, error: exErr } = await admin
        .from("welfare_followups")
        .select("user_id")
        .eq("reason", reason)
        .neq("status", "resolved")
        .in("user_id", userIds);
      if (exErr) throw new Error(exErr.message);
      const alreadyOpen = new Set((existing ?? []).map((r) => r.user_id));
      toFlag = userIds.filter((id) => !alreadyOpen.has(id));
      if (toFlag.length > 0) {
        const { error: insErr } = await admin
          .from("welfare_followups")
          .insert(toFlag.map((user_id) => ({ user_id, reason, auto_flagged: true })));
        if (insErr) throw new Error(insErr.message);
      }
    } catch {
      toFlag = userIds; // board entry failed — still notify the team
    }
    if (toFlag.length === 0) return;

    // Notify the welfare team, naming who needs a follow-up.
    const { data: profs } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", toFlag);
    const names = (profs ?? []).map((p) => p.full_name);
    const label = reason === "traveled" ? "traveled" : "inactive";
    const shown = names.slice(0, 5).join(", ");
    const more = names.length > 5 ? ` and ${names.length - 5} more` : "";

    await notifyRole("welfare", {
      type: `member_${reason}`,
      title:
        toFlag.length === 1
          ? `${names[0] ?? "A member"} was marked ${label}`
          : `${toFlag.length} members were marked ${label}`,
      body: `Please follow up: ${shown}${more}.`,
      link: "/welfare",
    });
  } else if (status === "active") {
    // Returning members: close any auto-opened traveled/inactive follow-ups.
    await resolveAutoFollowups(userIds, ["traveled", "inactive"]);
  } else if (status === "graduated" || status === "left") {
    // Someone who has graduated or left doesn't need chasing — close every
    // auto-opened follow-up (AUDIT WEL-7). These statuses used to fall through,
    // leaving the queue cluttered with people who are gone.
    await resolveAutoFollowups(userIds, ["traveled", "inactive", "missed_service"]);
  }
}

/**
 * Secretary adds a member to the roster (e.g. someone they know joined).
 * Creates an unclaimed record with member_origin='secretary' — NOT a welfare
 * "new member", so it does not open a welfare follow-up. The person claims it
 * later by signing up with a matching phone/email.
 */
export async function addMemberToRoster(input: {
  fullName: string;
  whatsappNumber: string;
  phone: string;
  email: string;
  primarySubunitId: string;
}): Promise<{ ok: boolean; error?: string }> {
  // Never throws: a thrown server-action error reaches the browser as Vercel's
  // generic "An error occurred…", which hid the real reason from secretaries.
  try {
    await requireSecretary();

    await createUnclaimedMember({
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      whatsappNumber: input.whatsappNumber,
      primarySubunitId: input.primarySubunitId,
      origin: "secretary",
    });

    revalidatePath("/secretary/roster");
    revalidatePath("/secretary");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add member." };
  }
}

export interface RemoveMembersResult {
  removed: number;
  failed: { userId: string; name: string; reason: string }[];
}

/**
 * Permanently removes members from the system (profile + login + their
 * memberships/attendance via cascade). Destructive — the UI confirms first.
 *
 * Three fixes (AUDIT ROS-1, SEC-7):
 *   - The `deleteUser` result is checked and reported. It used to be discarded,
 *     so the action returned normally and the UI said "removed" while the member
 *     was still there.
 *   - Deletion actually works now: migration 0011 added ON DELETE clauses to the
 *     five profiles references that had none, which raised a foreign-key
 *     violation for anyone who had ever uploaded a sheet, created a course,
 *     approved a module, decided an application, or been assigned a follow-up.
 *   - Super admins cannot be deleted from here, and a secretary cannot delete
 *     another privileged user. Previously any secretary could permanently
 *     delete the super admin.
 */
export async function removeMembers(userIds: string[]): Promise<RemoveMembersResult> {
  const session = await requireSecretary();
  const result: RemoveMembersResult = { removed: 0, failed: [] };
  if (userIds.length === 0) return result;

  // Never let someone delete their own account from here.
  const ids = userIds.filter((id) => id !== session.userId);
  if (ids.length === 0) return result;

  const admin = createAdminClient();

  const [{ data: profiles }, { data: roles }] = await Promise.all([
    admin.from("profiles").select("id, full_name").in("id", ids),
    admin.from("user_roles").select("user_id, role").in("user_id", ids),
  ]);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const rolesByUser = new Map<string, string[]>();
  for (const r of roles ?? []) {
    rolesByUser.set(r.user_id, [...(rolesByUser.get(r.user_id) ?? []), r.role]);
  }

  const isSuperAdmin = session.roles.includes("super_admin");

  for (const id of ids) {
    const name = nameById.get(id) ?? id;
    const theirRoles = rolesByUser.get(id) ?? [];

    // A super admin account is never deletable through the roster.
    if (theirRoles.includes("super_admin")) {
      result.failed.push({
        userId: id,
        name,
        reason: "super admins cannot be removed from the roster",
      });
      continue;
    }
    // Only a super admin may remove someone who holds a privileged role.
    const privileged = theirRoles.some((r) =>
      ["secretary", "welfare", "subunit_leader"].includes(r)
    );
    if (privileged && !isSuperAdmin) {
      result.failed.push({
        userId: id,
        name,
        reason: `holds the ${theirRoles.join("/")} role — a super admin must remove them`,
      });
      continue;
    }

    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      console.error(`[roster] could not delete member ${id}:`, error.message);
      result.failed.push({ userId: id, name, reason: error.message });
      continue;
    }
    result.removed++;
  }

  revalidatePath("/secretary/roster");
  revalidatePath("/secretary");
  revalidatePath("/welfare");
  revalidatePath("/admin/members");
  return result;
}

/**
 * Adds selected members to a subunit. Becomes their primary if they have none
 * yet, otherwise a secondary membership. Skips members already in that subunit
 * and anyone already at the subunit cap.
 */
export async function assignSubunit(userIds: string[], subunitId: string) {
  await requireSecretary();
  if (userIds.length === 0 || !subunitId) return { added: 0, skipped: 0 };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("subunit_members")
    .select("user_id, subunit_id, membership_type")
    .in("user_id", userIds);

  const byUser = new Map<string, { subunit_id: string; membership_type: string }[]>();
  for (const m of existing ?? []) {
    const list = byUser.get(m.user_id) ?? [];
    list.push({ subunit_id: m.subunit_id, membership_type: m.membership_type });
    byUser.set(m.user_id, list);
  }

  const toInsert: {
    user_id: string;
    subunit_id: string;
    membership_type: "primary" | "secondary";
  }[] = [];
  let skipped = 0;
  for (const userId of userIds) {
    const memberships = byUser.get(userId) ?? [];
    if (memberships.some((m) => m.subunit_id === subunitId)) {
      skipped++;
      continue; // already in this subunit
    }
    // The cap is also enforced by a DB trigger (migration 0011), so a
    // concurrent assignment can't slip past it.
    if (memberships.length >= MAX_SUBUNITS_PER_MEMBER) {
      skipped++;
      continue;
    }
    const hasPrimary = memberships.some((m) => m.membership_type === "primary");
    toInsert.push({
      user_id: userId,
      subunit_id: subunitId,
      membership_type: hasPrimary ? "secondary" : "primary",
    });
  }

  if (toInsert.length > 0) {
    const { error } = await admin.from("subunit_members").insert(toInsert);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/secretary/roster");
  revalidatePath("/secretary");
  revalidatePath("/leader/members");
  return { added: toInsert.length, skipped };
}

/**
 * Moves selected members to a different PRIMARY subunit (the one shown on the
 * roster). If they already belong to the target subunit it's promoted to
 * primary; their old primary becomes a secondary membership.
 */
export async function moveToSubunit(userIds: string[], subunitId: string) {
  await requireSecretary();
  if (userIds.length === 0 || !subunitId) return { moved: 0, skipped: 0 };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("subunit_members")
    .select("id, user_id, subunit_id, membership_type")
    .in("user_id", userIds);

  const byUser = new Map<
    string,
    { id: string; subunit_id: string; membership_type: string }[]
  >();
  for (const m of existing ?? []) {
    const list = byUser.get(m.user_id) ?? [];
    list.push({ id: m.id, subunit_id: m.subunit_id, membership_type: m.membership_type });
    byUser.set(m.user_id, list);
  }

  let moved = 0;
  let skipped = 0;
  for (const userId of userIds) {
    const memberships = byUser.get(userId) ?? [];
    const target = memberships.find((m) => m.subunit_id === subunitId);
    const primary = memberships.find((m) => m.membership_type === "primary");

    if (target) {
      if (target.membership_type === "primary") {
        skipped++; // already their primary subunit
        continue;
      }
      // Promote the target to primary, demote the old primary to secondary.
      await admin.from("subunit_members").update({ membership_type: "primary" }).eq("id", target.id);
      if (primary) {
        await admin.from("subunit_members").update({ membership_type: "secondary" }).eq("id", primary.id);
      }
      moved++;
    } else if (primary) {
      // Repoint their primary membership to the new subunit.
      await admin.from("subunit_members").update({ subunit_id: subunitId }).eq("id", primary.id);
      moved++;
    } else {
      // No memberships yet — create a primary one.
      await admin
        .from("subunit_members")
        .insert({ user_id: userId, subunit_id: subunitId, membership_type: "primary" });
      moved++;
    }
  }

  revalidatePath("/secretary/roster");
  revalidatePath("/secretary");
  return { moved, skipped };
}
