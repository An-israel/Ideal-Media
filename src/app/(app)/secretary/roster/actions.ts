"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionRoles } from "@/lib/auth";
import { createUnclaimedMember } from "@/lib/member-admin";
import { syncWelfareForStatus } from "@/lib/welfare-automation";
import { MAX_SUBUNITS_PER_MEMBER } from "@/lib/constants";
import { createClaimInvite, CLAIM_INVITE_DAYS } from "@/lib/claim-invite";
import { claimInviteMigrations } from "@/lib/schema-check";
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

    // createUnclaimedMember allows no subunit (roster-sync creates members
    // before subunits are assigned), but adding someone by hand always has
    // one, and a member with none is invisible on every attendance list.
    if (!input.primarySubunitId) {
      return { ok: false, error: "Please choose a primary subunit." };
    }

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
 * Archives members: they can no longer sign in and drop off every roster and
 * future report, but nothing about them is deleted.
 *
 * This used to call auth.admin.deleteUser, and a profile cascades into ten
 * tables — so removing one person from the roster also erased their attendance
 * history, their course and academy progress and their certificates, and
 * changed the totals of every past report they appeared in. It could not be
 * undone, and one mis-ticked row was enough. The department's rule is that
 * nobody is removed, so "remove" now means the same reversible archive the
 * members-list page uses, and restoreMembers() below is its undo.
 *
 * The protections are unchanged:
 *   - nobody archives themselves;
 *   - a secretary cannot archive someone holding a privileged role;
 *   - nobody can archive a super admin from here.
 */
export async function removeMembers(userIds: string[]): Promise<RemoveMembersResult> {
  const session = await requireSecretary();
  const result: RemoveMembersResult = { removed: 0, failed: [] };
  if (userIds.length === 0) return result;

  // Never let someone archive their own account from here.
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

    // A super admin account is never archived through the roster.
    if (theirRoles.includes("super_admin")) {
      result.failed.push({
        userId: id,
        name,
        reason: "super admins cannot be archived from the roster",
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
        reason: `holds the ${theirRoles.join("/")} role — a super admin must archive them`,
      });
      continue;
    }

    const { error } = await admin
      .from("profiles")
      .update({
        access_revoked_at: new Date().toISOString(),
        access_revoked_by: session.userId,
        access_revoked_reason: "Archived from the roster",
      })
      .eq("id", id);
    if (error) {
      console.error(`[roster] could not archive member ${id}:`, error.message);
      result.failed.push({ userId: id, name, reason: error.message });
      continue;
    }
    // Block sign-in too. The profile flag already turns them away at the app
    // layout and switches off their own-row policies; the ban stops a session
    // being issued at all. A failure here leaves them archived, which is the
    // part that matters, so it is reported rather than rolled back.
    const { error: banErr } = await admin.auth.admin.updateUserById(id, {
      ban_duration: "876000h",
    });
    if (banErr) {
      console.error(`[roster] archived ${id} but could not block sign-in:`, banErr.message);
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
 * Makes a claim link for one unclaimed member.
 *
 * Returns the token, not a full address: the page that asked knows what site
 * it is on, and building the link there means it is right on a preview
 * deployment as well as the live one.
 */
export async function createClaimLink(
  userId: string
): Promise<{ ok: true; token: string; name: string; days: number } | { ok: false; error: string }> {
  try {
    const session = await requireSecretary();
    const needs = await claimInviteMigrations();
    if (needs.length > 0) {
      return {
        ok: false,
        error: `Claim links need one more database step: run ${needs[0].file} in the Supabase SQL editor.`,
      };
    }

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("id, full_name, claimed")
      .eq("id", userId)
      .maybeSingle();
    if (!profile) return { ok: false, error: "That member no longer exists." };
    if (profile.claimed) {
      return {
        ok: false,
        error: `${profile.full_name} already has a working account, so there is nothing to claim.`,
      };
    }

    const token = await createClaimInvite(profile.id, session.userId);
    return { ok: true, token, name: profile.full_name, days: CLAIM_INVITE_DAYS };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not make the link." };
  }
}

/** Puts archived members back: access, sign-in and their place on the roll. */
export async function restoreMembers(userIds: string[]): Promise<RemoveMembersResult> {
  await requireSecretary();
  const result: RemoveMembersResult = { removed: 0, failed: [] };
  if (userIds.length === 0) return result;

  const admin = createAdminClient();
  const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", userIds);

  for (const p of profiles ?? []) {
    const { error } = await admin
      .from("profiles")
      .update({ access_revoked_at: null, access_revoked_by: null, access_revoked_reason: null })
      .eq("id", p.id);
    if (error) {
      result.failed.push({ userId: p.id, name: p.full_name, reason: error.message });
      continue;
    }
    const { error: banErr } = await admin.auth.admin.updateUserById(p.id, {
      ban_duration: "none",
    });
    if (banErr) {
      result.failed.push({
        userId: p.id,
        name: p.full_name,
        reason: `restored, but sign-in is still blocked: ${banErr.message}`,
      });
      continue;
    }
    result.removed++;
  }

  revalidatePath("/secretary/roster");
  revalidatePath("/secretary");
  revalidatePath("/admin/members");
  revalidatePath("/admin/roster-sync");
  revalidatePath("/attendance");
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
