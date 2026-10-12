"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionRoles } from "@/lib/auth";
import { fetchAllRows } from "@/lib/pagination";
import { parseMemberList, type ListedMember } from "@/lib/member-list";
import { reconcileRoster, type ExistingAccount } from "@/lib/roster-sync";
import { MAX_SUBUNITS_PER_MEMBER } from "@/lib/constants";

/**
 * Assigning members to a subunit from a pasted unit sheet.
 *
 * Same shape as the members-list reconciliation, and for the same reason: the
 * sheets disagree with each other in ways only a person can settle — a name
 * spelled two ways, a phone number that differs between lists, an entry that
 * is just a first name. So this previews and never writes on a guess.
 *
 * It deliberately does NOT remove anyone from a subunit. A sheet is a list of
 * who belongs, not a statement about who does not, and treating an omission as
 * a removal would quietly empty a subunit from an incomplete paste.
 */

async function requireSuperAdmin() {
  const session = await getSessionRoles();
  if (!session) throw new Error("You're signed out — please log in again.");
  if (!session.roles.includes("super_admin")) {
    throw new Error("Only a super admin can assign subunits.");
  }
  return session;
}

async function loadAccounts(): Promise<ExistingAccount[]> {
  const admin = createAdminClient();
  const profiles = await fetchAllRows<{
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
      .is("access_revoked_at", null)
      .range(from, to)
  );
  return profiles.map((p) => ({
    id: p.id,
    fullName: p.full_name,
    phone: p.phone,
    whatsappNumber: p.whatsapp_number,
    roles: [],
    memberStatus: p.member_status,
    accessRevoked: false,
  }));
}

export interface AssignRow {
  listed: ListedMember;
  accountId: string | null;
  accountName: string | null;
  confidence: string;
  /** Where they currently sit, so a move is visible before it happens. */
  currentPrimary: string | null;
  subunitCount: number;
  options: { id: string; fullName: string }[];
  note: string | null;
}

export interface AssignPreview {
  rows: AssignRow[];
  notFound: ListedMember[];
  unreadable: { line: number; text: string }[];
}

export async function previewSubunitAssignment(input: {
  text: string;
  subunitId: string;
}): Promise<{ ok: true; preview: AssignPreview } | { ok: false; error: string }> {
  try {
    await requireSuperAdmin();
    const parsed = parseMemberList(input.text);
    if (parsed.members.length === 0) {
      return { ok: false, error: "No members were found in that list." };
    }

    const admin = createAdminClient();
    const accounts = await loadAccounts();
    const plan = reconcileRoster(parsed.members, accounts);

    const ids = [
      ...plan.keep.map((k) => k.account.id),
      ...plan.confirm.flatMap((c) => c.options.map((o) => o.id)),
    ];

    const memberships = ids.length
      ? await fetchAllRows<{ user_id: string; subunit_id: string; membership_type: string }>(
          (from, to) =>
            admin
              .from("subunit_members")
              .select("user_id, subunit_id, membership_type")
              .in("user_id", ids)
              .range(from, to)
        )
      : [];
    const { data: subunits } = await admin.from("subunits").select("id, name");
    const subunitName = new Map((subunits ?? []).map((s) => [s.id, s.name]));

    const byUser = new Map<string, { subunitId: string; type: string }[]>();
    for (const m of memberships) {
      byUser.set(m.user_id, [
        ...(byUser.get(m.user_id) ?? []),
        { subunitId: m.subunit_id, type: m.membership_type },
      ]);
    }

    const describe = (accountId: string | null) => {
      const mine = accountId ? byUser.get(accountId) ?? [] : [];
      const primary = mine.find((m) => m.type === "primary");
      return {
        currentPrimary: primary ? subunitName.get(primary.subunitId) ?? "—" : null,
        subunitCount: mine.length,
      };
    };

    const rows: AssignRow[] = [
      ...plan.keep.map((k) => ({
        listed: k.listed,
        accountId: k.account.id,
        accountName: k.account.fullName,
        confidence: k.confidence,
        options: [],
        note: null as string | null,
        ...describe(k.account.id),
      })),
      ...plan.confirm.map((c) => ({
        listed: c.listed,
        accountId: null,
        accountName: null,
        confidence: "needs-decision",
        options: c.options.map((o) => ({ id: o.id, fullName: o.fullName })),
        note: c.reason,
        ...describe(null),
      })),
    ].sort((a, b) => a.listed.position - b.listed.position);

    return {
      ok: true,
      preview: { rows, notFound: plan.create, unreadable: parsed.unreadable },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read that list." };
  }
}

export interface ApplyAssignResult {
  ok: boolean;
  error?: string;
  assigned?: number;
  moved?: number;
  skipped?: string[];
}

export async function applySubunitAssignment(input: {
  subunitId: string;
  membershipType: "primary" | "secondary";
  userIds: string[];
}): Promise<ApplyAssignResult> {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();
    if (input.userIds.length === 0) return { ok: false, error: "Nobody was selected." };

    const memberships = await fetchAllRows<{
      id: string;
      user_id: string;
      subunit_id: string;
      membership_type: string;
    }>((from, to) =>
      admin
        .from("subunit_members")
        .select("id, user_id, subunit_id, membership_type")
        .in("user_id", input.userIds)
        .range(from, to)
    );
    const byUser = new Map<string, typeof memberships>();
    for (const m of memberships) byUser.set(m.user_id, [...(byUser.get(m.user_id) ?? []), m]);

    let assigned = 0;
    let moved = 0;
    const skipped: string[] = [];

    for (const userId of input.userIds) {
      const mine = byUser.get(userId) ?? [];
      const here = mine.find((m) => m.subunit_id === input.subunitId);

      if (here) {
        if (here.membership_type === input.membershipType) continue; // already right
        const { error } = await admin
          .from("subunit_members")
          .update({ membership_type: input.membershipType })
          .eq("id", here.id);
        if (error) skipped.push(`${userId}: ${error.message}`);
        else assigned++;
        continue;
      }

      if (input.membershipType === "primary") {
        const existingPrimary = mine.find((m) => m.membership_type === "primary");
        if (existingPrimary) {
          // A unique index allows one primary per person, so this is a MOVE
          // rather than an insert — which is also what the department means by
          // "this person is in this subunit".
          const { error } = await admin
            .from("subunit_members")
            .update({ subunit_id: input.subunitId })
            .eq("id", existingPrimary.id);
          if (error) skipped.push(`${userId}: ${error.message}`);
          else moved++;
          continue;
        }
      } else if (mine.length >= MAX_SUBUNITS_PER_MEMBER) {
        skipped.push(`${userId}: already in ${mine.length} subunits`);
        continue;
      }

      const { error } = await admin.from("subunit_members").insert({
        user_id: userId,
        subunit_id: input.subunitId,
        membership_type: input.membershipType,
      });
      if (error) skipped.push(`${userId}: ${error.message}`);
      else assigned++;
    }

    revalidatePath("/admin/subunit-assign");
    revalidatePath("/secretary/roster");
    revalidatePath("/attendance");
    return { ok: true, assigned, moved, skipped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not assign." };
  }
}
