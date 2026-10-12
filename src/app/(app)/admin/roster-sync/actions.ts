"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionRoles } from "@/lib/auth";
import { fetchAllRows, chunk } from "@/lib/pagination";
import { PAGE_SIZE } from "@/lib/constants";
import { parseMemberList, type ListedMember } from "@/lib/member-list";
import { reconcileRoster, type ExistingAccount, type RosterPlan } from "@/lib/roster-sync";
import { createUnclaimedMember } from "@/lib/member-admin";

/**
 * Reconciling the site against the official media members list.
 *
 * This is the most destructive thing in the app — it decides who keeps access —
 * so it is split in two. `previewRosterSync` reads and computes but writes
 * nothing; `applyRosterSync` writes only the decisions it is handed back.
 * Nothing is ever inferred twice: re-deriving the plan at apply time could
 * produce a different answer from the one a human approved.
 */

async function requireSuperAdmin() {
  const session = await getSessionRoles();
  if (!session) throw new Error("You're signed out — please log in again.");
  if (!session.roles.includes("super_admin")) {
    throw new Error("Only a super admin can reconcile the members list.");
  }
  return session;
}

async function loadAccounts(): Promise<ExistingAccount[]> {
  const admin = createAdminClient();
  const [profiles, roles] = await Promise.all([
    fetchAllRows<{
      id: string;
      full_name: string;
      phone: string | null;
      whatsapp_number: string | null;
      member_status: string;
      access_revoked_at: string | null;
    }>((from, to) =>
      admin
        .from("profiles")
        .select("id, full_name, phone, whatsapp_number, member_status, access_revoked_at")
        .range(from, to)
    ),
    fetchAllRows<{ user_id: string; role: string }>((from, to) =>
      admin.from("user_roles").select("user_id, role").range(from, to)
    ),
  ]);

  const rolesByUser = new Map<string, string[]>();
  for (const r of roles) {
    // 'member' is everybody, so it is not a role worth protecting an account
    // from removal over.
    if (r.role === "member") continue;
    rolesByUser.set(r.user_id, [...(rolesByUser.get(r.user_id) ?? []), r.role]);
  }

  return profiles.map((p) => ({
    id: p.id,
    fullName: p.full_name,
    phone: p.phone,
    whatsappNumber: p.whatsapp_number,
    roles: rolesByUser.get(p.id) ?? [],
    memberStatus: p.member_status,
    accessRevoked: p.access_revoked_at != null,
  }));
}

export interface PreviewResult {
  ok: true;
  plan: RosterPlan;
  parsed: {
    total: number;
    unreadable: { line: number; text: string }[];
    possibleDuplicates: { a: ListedMember; b: ListedMember }[];
    withoutPhone: ListedMember[];
    suspectPhones: ListedMember[];
  };
  accountsOnSite: number;
}

export async function previewRosterSync(input: {
  text: string;
  skipPositions?: number[];
}): Promise<PreviewResult | { ok: false; error: string }> {
  try {
    await requireSuperAdmin();
    const parsed = parseMemberList(input.text);
    if (parsed.members.length === 0) {
      return {
        ok: false,
        error:
          "No members were found. Each line should look like “1. Full Name - 08012345678”.",
      };
    }

    const accounts = await loadAccounts();
    const plan = reconcileRoster(parsed.members, accounts, {
      skipPositions: input.skipPositions,
    });

    return {
      ok: true,
      plan,
      parsed: {
        total: parsed.members.length,
        unreadable: parsed.unreadable,
        possibleDuplicates: parsed.possibleDuplicates,
        withoutPhone: parsed.withoutPhone,
        suspectPhones: parsed.suspectPhones,
      },
      accountsOnSite: accounts.length,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read that list." };
  }
}

export interface ApplyResult {
  ok: boolean;
  error?: string;
  revoked?: number;
  created?: number;
  failures?: string[];
}

/**
 * Applies exactly what was approved.
 *
 * Takes explicit ids rather than re-running the match, so what happens is what
 * was shown. Revocation does not delete: the profile is marked and the auth
 * user is banned, so the person cannot sign in while their attendance history
 * stays intact and the whole thing can be undone.
 */
export async function applyRosterSync(input: {
  revokeUserIds: string[];
  createMembers: { name: string; phone: string | null }[];
  reason: string;
}): Promise<ApplyResult> {
  try {
    const session = await requireSuperAdmin();
    const admin = createAdminClient();
    const failures: string[] = [];

    // Never let this lock out the person running it, whatever the list says.
    const toRevoke = input.revokeUserIds.filter((id) => id !== session.userId);
    if (toRevoke.length !== input.revokeUserIds.length) {
      failures.push("Your own account was left active.");
    }

    let revoked = 0;
    if (toRevoke.length > 0) {
      const now = new Date().toISOString();
      for (const batch of chunk(toRevoke, PAGE_SIZE)) {
        const { error } = await admin
          .from("profiles")
          .update({
            access_revoked_at: now,
            access_revoked_by: session.userId,
            access_revoked_reason: input.reason.trim() || "Not on the current members list",
          })
          .in("id", batch);
        if (error) return { ok: false, error: error.message };
        revoked += batch.length;
      }

      // Ban the auth user as well. The profile flag turns them away at the app
      // layout and switches off their RLS access, but banning stops a session
      // being issued at all — three independent locks rather than one.
      for (const id of toRevoke) {
        const { error } = await admin.auth.admin.updateUserById(id, {
          ban_duration: "876000h", // 100 years; lifted by restoring access
        });
        if (error) failures.push(`Could not ban sign-in for ${id}: ${error.message}`);
      }
    }

    let created = 0;
    for (const m of input.createMembers) {
      try {
        await createUnclaimedMember({
          fullName: m.name,
          email: "",
          phone: m.phone ?? "",
          whatsappNumber: m.phone ?? "",
          // No subunit yet: the department assigns primary subunits as its own
          // pass after this one. They show up in the report's "nobody reports on
          // them" list until that happens, so they cannot be quietly forgotten.
          origin: "secretary",
        });
        created++;
      } catch (e) {
        failures.push(`${m.name}: ${e instanceof Error ? e.message : "could not be created"}`);
      }
    }

    revalidatePath("/admin/roster-sync");
    revalidatePath("/secretary/roster");
    revalidatePath("/attendance");
    return { ok: true, revoked, created, failures };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not apply the changes." };
  }
}

/** Puts a revoked member back — the undo for a wrong match. */
export async function restoreAccess(userId: string): Promise<ApplyResult> {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();

    const { error } = await admin
      .from("profiles")
      .update({ access_revoked_at: null, access_revoked_by: null, access_revoked_reason: null })
      .eq("id", userId);
    if (error) return { ok: false, error: error.message };

    const { error: banErr } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: "none",
    });
    if (banErr) {
      return {
        ok: false,
        error: `Access restored, but sign-in is still blocked: ${banErr.message}`,
      };
    }

    revalidatePath("/admin/roster-sync");
    revalidatePath("/secretary/roster");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not restore access." };
  }
}
