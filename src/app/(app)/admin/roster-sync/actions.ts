"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionRoles } from "@/lib/auth";
import { fetchAllRows, chunk } from "@/lib/pagination";
import { PAGE_SIZE } from "@/lib/constants";
import { parseMemberList, type ListedMember } from "@/lib/member-list";
import { reconcileRoster, type ExistingAccount, type RosterPlan } from "@/lib/roster-sync";
import { createUnclaimedMember } from "@/lib/member-admin";
import {
  findRosterGap,
  type AccountLike,
  type MissingPerson,
  type SheetData,
} from "@/lib/roster-restore";
import memberSheets from "@/data/member-sheets.json";

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

// ============================================================================
//  Putting the department back together
// ============================================================================
//  The removal pass judged people against the 101-name members list, which
//  turned out to be narrower than the department actually is: the subunit
//  sheets name people who are not on it, and the department's decision is that
//  nobody is removed. These two actions are the reversal — restore everyone,
//  and create the people who were written on a sheet but never had an account.

export interface RestoreEveryoneResult {
  ok: boolean;
  error?: string;
  /** Had their access revocation cleared. */
  unrevoked?: number;
  /** Had member_status 'left' set back to active. */
  reactivated?: number;
  /** Had their Supabase sign-in ban lifted. */
  unbanned?: number;
  failures?: string[];
}

/**
 * Puts every removed member back.
 *
 * Three locks were used to remove someone and all three have to come off, which
 * is why this is an action and not another SQL script: the profile flag and
 * member_status are rows, but the sign-in ban lives in Supabase's auth schema
 * and is only liftable through the admin API.
 *
 * Nothing here is destructive and it is safe to run twice.
 */
export async function restoreEveryone(): Promise<RestoreEveryoneResult> {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();
    const failures: string[] = [];

    const revoked = await fetchAllRows<{ id: string }>((from, to) =>
      admin.from("profiles").select("id").not("access_revoked_at", "is", null).range(from, to)
    );
    const left = await fetchAllRows<{ id: string }>((from, to) =>
      admin.from("profiles").select("id").eq("member_status", "left").range(from, to)
    );

    let unrevoked = 0;
    for (const batch of chunk(revoked.map((r) => r.id), PAGE_SIZE)) {
      const { error } = await admin
        .from("profiles")
        .update({ access_revoked_at: null, access_revoked_by: null, access_revoked_reason: null })
        .in("id", batch);
      if (error) return { ok: false, error: error.message };
      unrevoked += batch.length;
    }

    let reactivated = 0;
    for (const batch of chunk(left.map((r) => r.id), PAGE_SIZE)) {
      const { error } = await admin
        .from("profiles")
        .update({ member_status: "active" })
        .in("id", batch);
      if (error) return { ok: false, error: error.message };
      reactivated += batch.length;
    }

    // Lift every sign-in ban that exists, found by asking Supabase who is
    // banned rather than assuming it is the people just un-revoked above.
    //
    // The first version unbanned exactly that list. If one unban failed, or
    // the function was cut off part way, the profile rows were already clean —
    // so pressing the button again found nobody "revoked", unbanned nobody,
    // and left people restored on paper but still locked out, with no way to
    // tell. Asking for the banned accounts makes a second press finish the job.
    const banned: string[] = [];
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) {
        failures.push(`Could not list sign-in bans: ${error.message}`);
        break;
      }
      for (const u of data.users) {
        const until = (u as { banned_until?: string | null }).banned_until;
        if (until && new Date(until).getTime() > Date.now()) banned.push(u.id);
      }
      if (data.users.length < 1000) break;
    }

    // In small parallel batches: one at a time, sixty unbans is long enough to
    // run into the function's time limit.
    let unbanned = 0;
    for (const batch of chunk(banned, 10)) {
      const results = await Promise.all(
        batch.map((id) => admin.auth.admin.updateUserById(id, { ban_duration: "none" }))
      );
      results.forEach((r, i) => {
        if (r.error) failures.push(`Could not restore sign-in for ${batch[i]}: ${r.error.message}`);
        else unbanned += 1;
      });
    }

    revalidatePath("/admin/roster-sync");
    revalidatePath("/secretary/roster");
    revalidatePath("/attendance");
    revalidatePath("/academy", "layout");
    return { ok: true, unrevoked, reactivated, unbanned, failures };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not restore access." };
  }
}

export interface MissingResult {
  ok: boolean;
  error?: string;
  missing?: MissingPerson[];
  present?: number;
  total?: number;
}

/** Who the department has written down but the site has no account for. */
export async function previewMissingMembers(): Promise<MissingResult> {
  try {
    await requireSuperAdmin();
    const accounts = await loadAccounts();
    const gap = findRosterGap(memberSheets as SheetData, accounts.map(toAccountLike));
    return { ok: true, missing: gap.missing, present: gap.present, total: gap.total };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not work that out." };
  }
}

export interface CreateMissingResult {
  ok: boolean;
  error?: string;
  created?: number;
  skipped?: number;
  failures?: string[];
}

/**
 * Creates an account for everyone named on a list who has none.
 *
 * Takes the names it was shown rather than recomputing them, for the same
 * reason the reconcile flow does: what happens must be what was approved.
 * Each name is re-checked against the site as it is created, so a person who
 * appeared twice, or who was created a moment ago, is skipped rather than
 * duplicated.
 */
export async function createMissingMembers(
  people: { name: string; phone: string | null }[]
): Promise<CreateMissingResult> {
  try {
    await requireSuperAdmin();
    const failures: string[] = [];
    let created = 0;
    let skipped = 0;

    // Read the site once, then keep that picture up to date as people are
    // created. Re-reading every profile before each person was thirty full
    // table reads for thirty people, for the sake of knowing about the one
    // account this loop had itself just made.
    const accounts: AccountLike[] = (await loadAccounts()).map(toAccountLike);
    const aliases = (memberSheets as SheetData).aliases;

    for (const person of people) {
      const name = person.name.trim();
      if (!name) continue;

      const gap = findRosterGap(
        { officialList: [{ name, phone: person.phone }], sheets: [], aliases },
        accounts
      );
      if (gap.missing.length === 0) {
        skipped += 1;
        continue;
      }

      try {
        const { userId } = await createUnclaimedMember({
          fullName: name,
          email: "",
          phone: person.phone ?? "",
          whatsappNumber: person.phone ?? "",
          // No subunit: they show up in the report's "nobody reports on them"
          // list until the department assigns one, so they cannot be forgotten.
          origin: "secretary",
        });
        accounts.push({
          id: userId,
          fullName: name,
          phone: person.phone,
          whatsappNumber: person.phone,
        });
        created += 1;
      } catch (e) {
        failures.push(`${name}: ${e instanceof Error ? e.message : "could not be created"}`);
      }
    }

    revalidatePath("/admin/roster-sync");
    revalidatePath("/secretary/roster");
    revalidatePath("/attendance");
    return { ok: true, created, skipped, failures };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create them." };
  }
}

function toAccountLike(a: ExistingAccount): AccountLike {
  return {
    id: a.id,
    fullName: a.fullName,
    phone: a.phone,
    whatsappNumber: a.whatsappNumber,
  };
}
