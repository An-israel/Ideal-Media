import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Claim invites: a single-use link that attaches one sign-up to one specific
 * roster record.
 *
 * Sign-up normally finds a person's record by their email, or their phone plus
 * their name. Members added from a subunit sheet with only a first name have
 * neither, so nothing could ever match them and they ended up with a second
 * account. The link is the match.
 */

const INVITE_DAYS = 14;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export interface ClaimInviteTarget {
  inviteId: string;
  userId: string;
  fullName: string;
}

/** Makes a fresh invite for a member, replacing any unused one they had. */
export async function createClaimInvite(userId: string, createdBy: string): Promise<string> {
  const admin = createAdminClient();

  // One live link per person: making a new one cancels the old, so a link sent
  // to the wrong number can be killed by simply sending another.
  const { error: clearErr } = await admin
    .from("member_claim_invites")
    .delete()
    .eq("user_id", userId)
    .is("used_at", null);
  if (clearErr) throw new Error(clearErr.message);

  const token = randomBytes(24).toString("base64url");
  const { error } = await admin.from("member_claim_invites").insert({
    user_id: userId,
    token_hash: hash(token),
    created_by: createdBy,
    expires_at: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString(),
  });
  if (error) throw new Error(error.message);
  return token;
}

/**
 * Who a token claims, or null if it cannot be used.
 *
 * Null for every failure alike — unknown, expired, already used, or the record
 * has since been claimed some other way — so the sign-up page cannot be used to
 * tell a real token from a guess.
 */
export async function resolveClaimInvite(token: string): Promise<ClaimInviteTarget | null> {
  const trimmed = token.trim();
  if (trimmed.length < 16 || trimmed.length > 128) return null;

  const admin = createAdminClient();
  const { data: invite, error } = await admin
    .from("member_claim_invites")
    .select("id, user_id, expires_at, used_at")
    .eq("token_hash", hash(trimmed))
    .maybeSingle();
  if (error || !invite) return null;
  if (invite.used_at || new Date(invite.expires_at).getTime() < Date.now()) return null;

  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name, claimed")
    .eq("id", invite.user_id)
    .maybeSingle();
  if (!profile || profile.claimed) return null;

  return { inviteId: invite.id, userId: profile.id, fullName: profile.full_name };
}

/** Marks an invite spent. Conditional on it being unspent, so it is used once. */
export async function consumeClaimInvite(inviteId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("member_claim_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("id", inviteId)
    .is("used_at", null)
    .select("id");
  return (data?.length ?? 0) > 0;
}

export const CLAIM_INVITE_DAYS = INVITE_DAYS;
