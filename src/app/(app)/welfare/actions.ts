"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionRoles } from "@/lib/auth";
import { notify } from "@/lib/notify";
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

  const update: Partial<WelfareFollowup> = {};
  if (patch.level !== undefined) update.level = patch.level;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.assignedTo !== undefined) update.assigned_to = patch.assignedTo;
  if (patch.markContacted) update.last_contact_at = new Date().toISOString();

  const { error } = await supabase.from("welfare_followups").update(update).eq("id", id);
  if (error) throw new Error(error.message);

  // Notify a newly-assigned welfare team member (Section 13).
  if (patch.assignedTo) {
    await notify({
      userId: patch.assignedTo,
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
  try {
    const session = await getSessionRoles();
    if (!session) return { ok: false, error: "You're signed out — please log in again." };
    if (!session.roles.includes("welfare") && !session.roles.includes("super_admin")) {
      return { ok: false, error: "Welfare access required." };
    }
    if (!input.fullName.trim()) return { ok: false, error: "Name is required." };
    if (!input.primarySubunitId) return { ok: false, error: "Please choose a primary subunit." };

    const admin = createAdminClient();
    const phone = (input.whatsappNumber || input.phone || "").replace(/[^\d+]/g, "");

    // Avoid creating a duplicate of someone already in the system.
    if (input.email.trim()) {
      const { data: byEmail } = await admin
        .from("profiles")
        .select("id")
        .eq("email", input.email.trim().toLowerCase())
        .limit(1);
      if (byEmail && byEmail.length) {
        return { ok: false, error: `${input.fullName} looks already added — someone with that email is on the roster.` };
      }
    }
    if (phone) {
      const { data: byPhone } = await admin
        .from("profiles")
        .select("id")
        .or(`whatsapp_number.eq.${phone},phone.eq.${phone}`)
        .limit(1);
      if (byPhone && byPhone.length) {
        return { ok: false, error: `${input.fullName} looks already added — someone with that phone number is on the roster.` };
      }
    }

    // Real email if known, otherwise a placeholder they'll replace when they claim.
    const email = input.email.trim().toLowerCase() || `nm-${randomUUID()}@no-email.ideal-media.app`;

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: randomUUID(),
      email_confirm: true,
      user_metadata: { full_name: input.fullName },
    });
    if (createErr || !created.user) {
      const msg = createErr?.message ?? "";
      if (/already been registered|already registered|duplicate/i.test(msg)) {
        return { ok: false, error: `${input.fullName} looks already added — that email already has an account.` };
      }
      return { ok: false, error: msg || "Could not add member." };
    }
    const userId = created.user.id;

    // If any of the linked rows fail, remove the auth user so we don't leave a
    // half-created member behind, and report the real reason.
    const cleanup = async (message: string): Promise<AddMemberResult> => {
      await admin.auth.admin.deleteUser(userId).catch(() => {});
      return { ok: false, error: message };
    };

    const { error: profErr } = await admin.from("profiles").insert({
      id: userId,
      full_name: input.fullName,
      email,
      phone: input.phone || null,
      whatsapp_number: input.whatsappNumber || null,
      member_status: "active",
      claimed: false,
      member_origin: "welfare",
    });
    if (profErr) return cleanup(profErr.message);

    const { error: roleErr } = await admin
      .from("user_roles")
      .insert({ user_id: userId, role: "member" });
    if (roleErr) return cleanup(roleErr.message);

    const { error: subErr } = await admin.from("subunit_members").insert({
      user_id: userId,
      subunit_id: input.primarySubunitId,
      membership_type: "primary",
    });
    if (subErr) return cleanup(subErr.message);

    const { error: fuErr } = await admin.from("welfare_followups").insert({
      user_id: userId,
      reason: "new_member",
      auto_flagged: false,
      notes: input.notes || null,
    });
    if (fuErr) return cleanup(fuErr.message);

    // Notify the secretaries — the new member now shows on their roster.
    const { data: secretaries } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "secretary");
    for (const s of secretaries ?? []) {
      await notify({
        userId: s.user_id,
        type: "new_member_added",
        title: "New member added",
        body: `${input.fullName} was added by welfare and is now on the roster.`,
        link: "/secretary/roster",
      });
    }

    revalidatePath("/welfare");
    revalidatePath("/secretary/roster");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add member." };
  }
}
