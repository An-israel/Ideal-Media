"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionRoles, type SessionRoles } from "@/lib/auth";
import { notify, notifyMany, notifyRole } from "@/lib/notify";
import { MAX_SUBUNITS_PER_MEMBER } from "@/lib/constants";

async function requireUser(): Promise<SessionRoles> {
  const session = await getSessionRoles();
  if (!session) throw new Error("Not authenticated");
  return session;
}

export interface SubunitActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

/** Everyone who should hear about a membership change in a subunit. */
async function notifyLeadersOfSubunit(
  subunitId: string,
  notification: { type: string; title: string; body: string; link: string }
) {
  const admin = createAdminClient();
  const { data: leaders } = await admin
    .from("subunit_members")
    .select("user_id")
    .eq("subunit_id", subunitId)
    .eq("role_in_subunit", "leader");
  await notifyMany(
    (leaders ?? []).map((l) => ({ ...notification, userId: l.user_id }))
  );
}

/**
 * Joins an EXTRA (secondary) subunit. Instant — it costs nothing to undo, and
 * it is what lets a member reach that subunit's courses to apply for them.
 *
 * Note this grants MEMBERSHIP, never a role: joining the Welfare subunit does
 * not make anyone a welfare officer. Roles are granted only by a super admin.
 */
export async function joinSubunit(subunitId: string): Promise<SubunitActionResult> {
  const session = await requireUser();
  if (!subunitId) return { ok: false, error: "Pick a subunit." };

  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: subunit } = await admin
    .from("subunits")
    .select("id, name")
    .eq("id", subunitId)
    .maybeSingle();
  if (!subunit) return { ok: false, error: "That subunit no longer exists." };

  const { data: existing } = await supabase
    .from("subunit_members")
    .select("id, membership_type")
    .eq("user_id", session.userId)
    .eq("subunit_id", subunitId)
    .maybeSingle();
  if (existing) {
    return {
      ok: false,
      error: `You're already in ${subunit.name}${
        existing.membership_type === "primary" ? " as your primary subunit" : ""
      }.`,
    };
  }

  const { count } = await supabase
    .from("subunit_members")
    .select("id", { count: "exact", head: true })
    .eq("user_id", session.userId);

  if ((count ?? 0) >= MAX_SUBUNITS_PER_MEMBER) {
    return {
      ok: false,
      error: `You're already in ${MAX_SUBUNITS_PER_MEMBER} subunits, which is the limit. Leave one first.`,
    };
  }

  // Their first subunit becomes their primary; otherwise it's an extra.
  const membershipType = (count ?? 0) === 0 ? "primary" : "secondary";

  // Self-insert under RLS, which permits role_in_subunit = 'member' only — so
  // this can never be used to grant leadership.
  const { error } = await supabase.from("subunit_members").insert({
    user_id: session.userId,
    subunit_id: subunitId,
    membership_type: membershipType,
    role_in_subunit: "member",
  });
  if (error) return { ok: false, error: error.message };

  // Auto-enroll into that subunit's published courses if this is now primary.
  if (membershipType === "primary") {
    const { data: courses } = await admin
      .from("courses")
      .select("id")
      .eq("subunit_id", subunitId)
      .eq("is_published", true);
    if (courses?.length) {
      await admin.from("enrollments").upsert(
        courses.map((c) => ({
          user_id: session.userId,
          course_id: c.id,
          status: "enrolled" as const,
        })),
        { onConflict: "user_id,course_id", ignoreDuplicates: true }
      );
    }
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", session.userId)
    .maybeSingle();

  await notifyLeadersOfSubunit(subunitId, {
    type: "subunit_joined",
    title: `${profile?.full_name ?? "A member"} joined ${subunit.name}`,
    body:
      membershipType === "primary"
        ? `${profile?.full_name ?? "A member"} set ${subunit.name} as their primary subunit.`
        : `${profile?.full_name ?? "A member"} joined ${subunit.name} as an additional subunit.`,
    link: "/leader/members",
  });

  revalidatePath("/subunits");
  revalidatePath("/dashboard");
  revalidatePath("/courses");
  return {
    ok: true,
    message:
      membershipType === "primary"
        ? `${subunit.name} is now your primary subunit.`
        : `You've joined ${subunit.name}. Its courses are now available to request.`,
  };
}

/**
 * Leaves an EXTRA subunit. A primary subunit cannot be left this way — that is
 * a change, not a departure, and goes through requestPrimaryChange so the
 * member is never left with no primary (which would drop them off the
 * attendance roster silently).
 */
export async function leaveSubunit(subunitId: string): Promise<SubunitActionResult> {
  const session = await requireUser();
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: membership } = await supabase
    .from("subunit_members")
    .select("id, membership_type")
    .eq("user_id", session.userId)
    .eq("subunit_id", subunitId)
    .maybeSingle();
  if (!membership) return { ok: false, error: "You're not in that subunit." };

  if (membership.membership_type === "primary") {
    return {
      ok: false,
      error:
        "This is your primary subunit. Request a change to a different primary subunit instead of leaving it.",
    };
  }

  const { data: subunit } = await admin
    .from("subunits")
    .select("name")
    .eq("id", subunitId)
    .maybeSingle();

  // A member may only delete their own membership row — RLS has no member-scoped
  // DELETE policy, so this runs on the admin client after the ownership check
  // above.
  const { error } = await admin
    .from("subunit_members")
    .delete()
    .eq("id", membership.id)
    .eq("user_id", session.userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/subunits");
  revalidatePath("/dashboard");
  revalidatePath("/courses");
  return { ok: true, message: `You've left ${subunit?.name ?? "the subunit"}.` };
}

/**
 * Requests a change of PRIMARY subunit.
 *
 * Primary decides which attendance roster the member appears on and which
 * courses auto-enroll them, so this is reviewed rather than instant — people
 * moving in and out of attendance tracking unseen would make the register
 * meaningless. Fixing a mistaken join is exactly what this is for, so the
 * reason field is passed straight to the reviewer.
 */
export async function requestPrimaryChange(
  subunitId: string,
  reason: string
): Promise<SubunitActionResult> {
  const session = await requireUser();
  if (!subunitId) return { ok: false, error: "Pick the subunit you want to move to." };

  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: target } = await admin
    .from("subunits")
    .select("id, name")
    .eq("id", subunitId)
    .maybeSingle();
  if (!target) return { ok: false, error: "That subunit no longer exists." };

  const { data: current } = await supabase
    .from("subunit_members")
    .select("subunit_id, subunits(name)")
    .eq("user_id", session.userId)
    .eq("membership_type", "primary")
    .maybeSingle();

  if (current?.subunit_id === subunitId) {
    return { ok: false, error: `${target.name} is already your primary subunit.` };
  }

  // No primary yet? Then there is nothing to review — just set it.
  if (!current) {
    return joinSubunit(subunitId);
  }

  const { data: pending } = await supabase
    .from("subunit_requests")
    .select("id, subunit_id")
    .eq("user_id", session.userId)
    .eq("status", "pending")
    .maybeSingle();
  if (pending) {
    return {
      ok: false,
      error: "You already have a change request waiting for review. Cancel it first.",
    };
  }

  const { error } = await supabase.from("subunit_requests").insert({
    user_id: session.userId,
    subunit_id: subunitId,
    current_subunit_id: current.subunit_id,
    kind: "change_primary",
    status: "pending",
    reason: reason.trim() || null,
  });
  if (error) return { ok: false, error: error.message };

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", session.userId)
    .maybeSingle();
  const currentName =
    (current as unknown as { subunits: { name: string } | null }).subunits?.name ??
    "their current subunit";
  const who = profile?.full_name ?? "A member";

  // Both sides of the move should know, plus the secretaries who keep the roster.
  await notifyLeadersOfSubunit(subunitId, {
    type: "subunit_change_request",
    title: `${who} wants to move into ${target.name}`,
    body: `Currently in ${currentName}. ${reason.trim() || "No reason given."}`,
    link: "/subunits/requests",
  });
  await notifyLeadersOfSubunit(current.subunit_id, {
    type: "subunit_change_request",
    title: `${who} wants to move out of ${currentName}`,
    body: `They've asked to move to ${target.name}. ${reason.trim() || "No reason given."}`,
    link: "/subunits/requests",
  });
  await notifyRole("secretary", {
    type: "subunit_change_request",
    title: `${who} requested a subunit change`,
    body: `${currentName} → ${target.name}. ${reason.trim() || "No reason given."}`,
    link: "/subunits/requests",
  });

  revalidatePath("/subunits");
  revalidatePath("/subunits/requests");
  return {
    ok: true,
    message: `Request sent. A leader or secretary will review your move to ${target.name}.`,
  };
}

/** The member withdraws their own pending request. */
export async function cancelPrimaryChangeRequest(
  requestId: string
): Promise<SubunitActionResult> {
  const session = await requireUser();
  const supabase = await createClient();

  const { data: request } = await supabase
    .from("subunit_requests")
    .select("id, user_id, status")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { ok: false, error: "That request no longer exists." };
  if (request.user_id !== session.userId) {
    return { ok: false, error: "That isn't your request." };
  }
  if (request.status !== "pending") {
    return { ok: false, error: "That request has already been decided." };
  }

  const { error } = await supabase
    .from("subunit_requests")
    .update({ status: "cancelled" })
    .eq("id", requestId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/subunits");
  revalidatePath("/subunits/requests");
  return { ok: true, message: "Request cancelled." };
}

/**
 * Approves or rejects a primary-change request.
 *
 * On approval the move is applied atomically enough to be safe: the new primary
 * is written first (so the member is never left without one), and their old
 * primary is demoted to a secondary membership rather than deleted, which
 * preserves their history in that subunit.
 */
export async function decideSubunitRequest(
  requestId: string,
  approve: boolean,
  note: string
): Promise<SubunitActionResult> {
  const session = await requireUser();
  const admin = createAdminClient();

  const { data: request } = await admin
    .from("subunit_requests")
    .select("id, user_id, subunit_id, current_subunit_id, status")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { ok: false, error: "That request no longer exists." };
  if (request.status !== "pending") {
    return { ok: false, error: "That request has already been decided." };
  }

  // Authorised: secretary, super admin, or a leader of either side of the move.
  const isReviewer =
    session.roles.includes("super_admin") ||
    session.roles.includes("secretary") ||
    session.ledSubunitIds.includes(request.subunit_id) ||
    (request.current_subunit_id !== null &&
      session.ledSubunitIds.includes(request.current_subunit_id));
  if (!isReviewer) {
    return { ok: false, error: "You can't decide this request." };
  }

  const [{ data: target }, { data: profile }] = await Promise.all([
    admin.from("subunits").select("name").eq("id", request.subunit_id).maybeSingle(),
    admin.from("profiles").select("full_name").eq("id", request.user_id).maybeSingle(),
  ]);

  if (approve) {
    const { data: memberships } = await admin
      .from("subunit_members")
      .select("id, subunit_id, membership_type")
      .eq("user_id", request.user_id);

    const oldPrimary = (memberships ?? []).find((m) => m.membership_type === "primary");
    const alreadyInTarget = (memberships ?? []).find(
      (m) => m.subunit_id === request.subunit_id
    );

    // Demote the old primary FIRST: the one_primary_per_user partial unique
    // index allows only a single primary row, so promoting before demoting
    // would collide.
    if (oldPrimary && oldPrimary.subunit_id !== request.subunit_id) {
      const { error } = await admin
        .from("subunit_members")
        .update({ membership_type: "secondary" })
        .eq("id", oldPrimary.id);
      if (error) return { ok: false, error: `Could not move them: ${error.message}` };
    }

    if (alreadyInTarget) {
      const { error } = await admin
        .from("subunit_members")
        .update({ membership_type: "primary" })
        .eq("id", alreadyInTarget.id);
      if (error) return { ok: false, error: `Could not move them: ${error.message}` };
    } else {
      const { error } = await admin.from("subunit_members").insert({
        user_id: request.user_id,
        subunit_id: request.subunit_id,
        membership_type: "primary",
        role_in_subunit: "member",
      });
      if (error) {
        // Put their old primary back rather than leaving them with none.
        if (oldPrimary) {
          await admin
            .from("subunit_members")
            .update({ membership_type: "primary" })
            .eq("id", oldPrimary.id);
        }
        return { ok: false, error: `Could not move them: ${error.message}` };
      }
    }

    // Auto-enroll into the new primary subunit's published courses.
    const { data: courses } = await admin
      .from("courses")
      .select("id")
      .eq("subunit_id", request.subunit_id)
      .eq("is_published", true);
    if (courses?.length) {
      await admin.from("enrollments").upsert(
        courses.map((c) => ({
          user_id: request.user_id,
          course_id: c.id,
          status: "enrolled" as const,
        })),
        { onConflict: "user_id,course_id", ignoreDuplicates: true }
      );
    }
  }

  const { error: updateErr } = await admin
    .from("subunit_requests")
    .update({
      status: approve ? "approved" : "rejected",
      decided_by: session.userId,
      decided_at: new Date().toISOString(),
      decision_note: note.trim() || null,
    })
    .eq("id", requestId);
  if (updateErr) return { ok: false, error: updateErr.message };

  await notify({
    userId: request.user_id,
    type: approve ? "subunit_change_approved" : "subunit_change_rejected",
    title: approve ? "Subunit change approved" : "Subunit change declined",
    body: approve
      ? `${target?.name ?? "Your new subunit"} is now your primary subunit.`
      : `Your request to move to ${target?.name ?? "another subunit"} was declined.${
          note.trim() ? ` ${note.trim()}` : ""
        }`,
    link: "/subunits",
  });

  revalidatePath("/subunits");
  revalidatePath("/subunits/requests");
  revalidatePath("/dashboard");
  revalidatePath("/leader/members");
  revalidatePath("/secretary/roster");
  return {
    ok: true,
    message: approve
      ? `${profile?.full_name ?? "The member"} moved to ${target?.name ?? "their new subunit"}.`
      : "Request declined.",
  };
}
