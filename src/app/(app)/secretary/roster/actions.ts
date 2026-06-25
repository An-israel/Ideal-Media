"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionRoles } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { getWelfareTeam } from "@/lib/welfare-queries";
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
  await syncWelfareForStatus(userIds, status);

  revalidatePath("/secretary/roster");
  revalidatePath("/secretary");
  revalidatePath("/welfare");
}

async function syncWelfareForStatus(userIds: string[], status: MemberStatus) {
  const admin = createAdminClient();

  if (status === "traveled" || status === "inactive") {
    const reason = status; // both are valid welfare_reason values
    // Skip anyone who already has an open follow-up for this reason.
    const { data: existing } = await admin
      .from("welfare_followups")
      .select("user_id")
      .eq("reason", reason)
      .neq("status", "resolved")
      .in("user_id", userIds);
    const alreadyOpen = new Set((existing ?? []).map((r) => r.user_id));
    const toFlag = userIds.filter((id) => !alreadyOpen.has(id));
    if (toFlag.length === 0) return;

    await admin
      .from("welfare_followups")
      .insert(toFlag.map((user_id) => ({ user_id, reason, auto_flagged: true })));

    // Notify the welfare team, naming who needs a follow-up.
    const { data: profs } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", toFlag);
    const names = (profs ?? []).map((p) => p.full_name);
    const label = reason === "traveled" ? "traveled" : "inactive";
    const team = await getWelfareTeam();
    const shown = names.slice(0, 5).join(", ");
    const more = names.length > 5 ? ` and ${names.length - 5} more` : "";
    for (const t of team) {
      await notify({
        userId: t.id,
        type: `member_${reason}`,
        title:
          toFlag.length === 1
            ? `${names[0]} was marked ${label}`
            : `${toFlag.length} members were marked ${label}`,
        body: `Please follow up: ${shown}${more}.`,
        link: "/welfare",
      });
    }
  } else if (status === "active") {
    // Returning members: close any auto-opened traveled/inactive follow-ups.
    await admin
      .from("welfare_followups")
      .update({ status: "resolved" })
      .in("user_id", userIds)
      .in("reason", ["traveled", "inactive"])
      .eq("auto_flagged", true)
      .neq("status", "resolved");
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
}) {
  await requireSecretary();
  if (!input.fullName.trim()) throw new Error("Name is required.");
  if (!input.primarySubunitId) throw new Error("Please choose a primary subunit.");

  const admin = createAdminClient();
  const phone = (input.whatsappNumber || input.phone || "").replace(/[^\d+]/g, "");

  if (input.email.trim()) {
    const { data: byEmail } = await admin
      .from("profiles")
      .select("id")
      .eq("email", input.email.trim().toLowerCase())
      .limit(1);
    if (byEmail && byEmail.length) throw new Error("Someone with that email is already in the system.");
  }
  if (phone) {
    const { data: byPhone } = await admin
      .from("profiles")
      .select("id")
      .or(`whatsapp_number.eq.${phone},phone.eq.${phone}`)
      .limit(1);
    if (byPhone && byPhone.length) throw new Error("Someone with that phone number is already in the system.");
  }

  const email = input.email.trim().toLowerCase() || `nm-${randomUUID()}@no-email.ideal-media.app`;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: randomUUID(),
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });
  if (createErr || !created.user) throw new Error(createErr?.message ?? "Could not add member.");
  const userId = created.user.id;

  await admin.from("profiles").insert({
    id: userId,
    full_name: input.fullName,
    email,
    phone: input.phone || null,
    whatsapp_number: input.whatsappNumber || null,
    member_status: "active",
    claimed: false,
    member_origin: "secretary",
  });
  await admin.from("user_roles").insert({ user_id: userId, role: "member" });
  await admin.from("subunit_members").insert({
    user_id: userId,
    subunit_id: input.primarySubunitId,
    membership_type: "primary",
  });

  revalidatePath("/secretary/roster");
  revalidatePath("/secretary");
}

/**
 * Permanently removes members from the system (profile + login + their
 * memberships/attendance via cascade). Destructive — the UI confirms first.
 */
export async function removeMembers(userIds: string[]) {
  const session = await requireSecretary();
  if (userIds.length === 0) return;
  // Never let someone delete their own account from here.
  const ids = userIds.filter((id) => id !== session.userId);
  if (ids.length === 0) return;

  const admin = createAdminClient();
  for (const id of ids) {
    // Deleting the auth user cascades to profiles and dependent rows.
    await admin.auth.admin.deleteUser(id);
  }

  revalidatePath("/secretary/roster");
  revalidatePath("/secretary");
}

/**
 * Adds selected members to a subunit. Becomes their primary if they have none
 * yet, otherwise a secondary membership. Skips members already in that subunit
 * and anyone already in 4 subunits (the cap).
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

  const toInsert: { user_id: string; subunit_id: string; membership_type: "primary" | "secondary" }[] = [];
  let skipped = 0;
  for (const userId of userIds) {
    const memberships = byUser.get(userId) ?? [];
    if (memberships.some((m) => m.subunit_id === subunitId)) {
      skipped++;
      continue; // already in this subunit
    }
    if (memberships.length >= 4) {
      skipped++;
      continue; // at the 4-subunit cap
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
