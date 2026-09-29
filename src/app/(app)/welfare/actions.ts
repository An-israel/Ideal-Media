"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionRoles } from "@/lib/auth";
import { notify, notifyRole } from "@/lib/notify";
import { createUnclaimedMember } from "@/lib/member-admin";
import { MAX_WELFARE_LEVEL } from "@/lib/constants";
import type { WelfareFollowup, WelfareStatus } from "@/lib/database.types";

async function requireWelfare() {
  const session = await getSessionRoles();
  if (!session) throw new Error("Not authenticated");
  if (!session.roles.includes("welfare") && !session.roles.includes("super_admin")) {
    throw new Error("Welfare access required");
  }
  return session;
}

export async function updateFollowup(
  id: string,
  patch: {
    level?: number;
    status?: WelfareStatus;
    notes?: string;
    assignedTo?: string | null;
    markContacted?: boolean;
  }
) {
  await requireWelfare();
  const supabase = await createClient();

  // Read the current row first so we can tell what actually changed. Validated
  // against the level range here rather than letting the DB check constraint
  // throw a raw Postgres error at the UI (AUDIT DATA-4).
  const { data: current, error: readErr } = await supabase
    .from("welfare_followups")
    .select("assigned_to, level, status")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!current) throw new Error("That follow-up no longer exists.");

  const update: Partial<WelfareFollowup> = {};
  if (patch.level !== undefined) {
    const level = Math.floor(patch.level);
    if (!Number.isFinite(level) || level < 1 || level > MAX_WELFARE_LEVEL) {
      throw new Error(`Level must be between 1 and ${MAX_WELFARE_LEVEL}.`);
    }
    update.level = level;
  }
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.assignedTo !== undefined) update.assigned_to = patch.assignedTo;
  if (patch.markContacted) update.last_contact_at = new Date().toISOString();

  const { error } = await supabase.from("welfare_followups").update(update).eq("id", id);
  if (error) throw new Error(error.message);

  // Notify only on an actual change of assignee (AUDIT WEL-4). The condition
  // used to be "assignedTo is present in the patch", so editing the notes or
  // status of an already-assigned follow-up re-notified the assignee every
  // time it was saved.
  const assigneeChanged =
    patch.assignedTo !== undefined &&
    patch.assignedTo !== null &&
    patch.assignedTo !== current.assigned_to;

  if (assigneeChanged) {
    await notify({
      userId: patch.assignedTo!,
      type: "welfare_assigned",
      title: "Welfare follow-up assigned to you",
      body: "A follow-up has been assigned to you.",
      link: "/welfare",
    });
  }

  revalidatePath("/welfare");
}

export interface NewMemberInput {
  fullName: string;
  whatsappNumber: string;
  phone: string;
  email: string;
  primarySubunitId: string;
  notes: string;
}

export interface AddMemberResult {
  ok: boolean;
  error?: string;
}

/**
 * Welfare adds a new member they met (e.g. a Sunday visitor). Creates an
 * unclaimed member record so it shows on the secretary's roster, opens a
 * new-member follow-up on the welfare board, and notifies the secretaries.
 * The person claims the record later by signing up with a matching phone.
 *
 * Returns a result object (never throws) — a thrown error in a server action
 * is masked by Vercel in production ("An error occurred in the Server
 * Components render…"), which hid the real reason (usually "already exists").
 */
export async function addNewMember(input: NewMemberInput): Promise<AddMemberResult> {
  // Never throws: a thrown error in a server action is masked by Vercel in
  // production, which is what hid the real reason from welfare for weeks.
  try {
    await requireWelfare();

    // Creation is transactional-ish: the auth user is rolled back if any later
    // step fails, so a failure can't leave an orphaned login (AUDIT ROS-2).
    // It also runs the duplicate check on normalised phone digits, so
    // "08031234567" and "+2348031234567" are recognised as the same person.
    const { userId } = await createUnclaimedMember({
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      whatsappNumber: input.whatsappNumber,
      primarySubunitId: input.primarySubunitId,
      origin: "welfare",
    });

    const admin = createAdminClient();
    const { error: followupErr } = await admin.from("welfare_followups").insert({
      user_id: userId,
      reason: "new_member",
      auto_flagged: false,
      notes: input.notes || null,
    });
    if (followupErr) {
      // The member exists and is on the roster; only the board entry failed.
      console.error("[welfare] could not open new-member followup:", followupErr.message);
    }

    // Notify the secretaries — the new member now shows on their roster. One
    // batched insert rather than a client and a round trip per recipient.
    await notifyRole("secretary", {
      type: "new_member_added",
      title: "New member added",
      body: `${input.fullName.trim()} was added by welfare and is now on the roster.`,
      link: "/secretary/roster",
    });

    revalidatePath("/welfare");
    revalidatePath("/secretary/roster");
    revalidatePath("/secretary");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add member." };
  }
}
