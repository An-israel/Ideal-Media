"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/database.types";

export interface SignupInput {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  password: string;
  whatsappNumber: string;
  primarySubunitId: string;
  secondarySubunitIds: string[];
}

export interface SignupResult {
  ok: boolean;
  error?: string;
  /** Email the client should sign in with (may differ from typed email on a claim). */
  signInEmail?: string;
}

type AdminClient = ReturnType<typeof createAdminClient>;

/** Enroll a user into all published courses of a subunit (auto-enroll). */
async function enrollPrimaryCourses(admin: AdminClient, userId: string, subunitId: string) {
  const { data: courses } = await admin
    .from("courses")
    .select("id")
    .eq("subunit_id", subunitId)
    .eq("is_published", true);
  if (courses && courses.length) {
    await admin.from("enrollments").upsert(
      courses.map((c) => ({ user_id: userId, course_id: c.id, status: "enrolled" as const })),
      { onConflict: "user_id,course_id", ignoreDuplicates: true }
    );
  }
}

/**
 * Sign up (Section 6) with claim-by-phone for imported members. If a person's
 * details match a pre-imported, unclaimed record (by email or phone), we set
 * their chosen password on that record and attach it — no password-reset email.
 * Otherwise we create a fresh account.
 */
export async function signUpAction(input: SignupInput): Promise<SignupResult> {
  const { fullName, email, password, primarySubunitId } = input;
  const lowerEmail = email.trim().toLowerCase();

  if (!fullName.trim() || !lowerEmail || !password) {
    return { ok: false, error: "Please fill in all required fields." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  if (!primarySubunitId) {
    return { ok: false, error: "Please select your primary subunit." };
  }

  const admin = createAdminClient();
  // Match by the last 10 digits so 0803… and +234803… are treated as the same.
  const last10 = (p: string) => p.replace(/\D/g, "").slice(-10);
  const phoneKey = last10(input.whatsappNumber || input.phone || "");

  // Pull existing members and match by email, then by phone (in code, so phone
  // formatting differences don't cause a miss → no accidental duplicate).
  const { data: allProfiles } = await admin
    .from("profiles")
    .select("id, email, phone, whatsapp_number, claimed");

  let match: { id: string; email: string; claimed: boolean } | null = null;
  for (const p of allProfiles ?? []) {
    if (p.email && p.email.toLowerCase() === lowerEmail) {
      match = { id: p.id, email: p.email, claimed: p.claimed };
      break;
    }
  }
  if (!match && phoneKey.length >= 7) {
    for (const p of allProfiles ?? []) {
      if (
        (p.phone && last10(p.phone) === phoneKey) ||
        (p.whatsapp_number && last10(p.whatsapp_number) === phoneKey)
      ) {
        match = { id: p.id, email: p.email, claimed: p.claimed };
        break;
      }
    }
  }

  // ---- Claim an imported, unclaimed record ----
  if (match && !match.claimed) {
    // Set their chosen password. If they typed a different email than the one on
    // record (e.g. a welfare-added member with a placeholder email), move the
    // login email to the typed one when it's free.
    let signInEmail = match.email;
    let claimErr: string | null = null;
    if (lowerEmail && lowerEmail !== match.email) {
      const moved = await admin.auth.admin.updateUserById(match.id, {
        email: lowerEmail,
        email_confirm: true,
        password,
      });
      if (!moved.error) {
        signInEmail = lowerEmail;
      } else {
        const keep = await admin.auth.admin.updateUserById(match.id, { password });
        claimErr = keep.error?.message ?? null;
      }
    } else {
      const r = await admin.auth.admin.updateUserById(match.id, { password });
      claimErr = r.error?.message ?? null;
    }
    if (claimErr) return { ok: false, error: claimErr };

    const update: Partial<Profile> = { claimed: true, email: signInEmail };
    if (fullName) update.full_name = fullName;
    if (input.location) update.location = input.location;
    if (input.whatsappNumber) update.whatsapp_number = input.whatsappNumber;
    if (input.phone) update.phone = input.phone;
    await admin.from("profiles").update(update).eq("id", match.id);

    await admin
      .from("user_roles")
      .upsert({ user_id: match.id, role: "member" }, { onConflict: "user_id,role", ignoreDuplicates: true });

    // Make sure they have a primary subunit (use the imported one, else chosen).
    const { data: prim } = await admin
      .from("subunit_members")
      .select("subunit_id")
      .eq("user_id", match.id)
      .eq("membership_type", "primary")
      .maybeSingle();
    let primarySubunit = prim?.subunit_id;
    if (!primarySubunit) {
      await admin.from("subunit_members").upsert(
        { user_id: match.id, subunit_id: primarySubunitId, membership_type: "primary" },
        { onConflict: "subunit_id,user_id", ignoreDuplicates: true }
      );
      primarySubunit = primarySubunitId;
    }
    if (primarySubunit) await enrollPrimaryCourses(admin, match.id, primarySubunit);

    // No new_member welfare flag — they're an existing member.
    return { ok: true, signInEmail };
  }

  // ---- Already a real (claimed) account ----
  if (match && match.claimed) {
    return {
      ok: false,
      error: "You're already registered. Please use Log in instead.",
    };
  }

  // ---- Brand-new member ----
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: lowerEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createErr || !created.user) {
    return { ok: false, error: createErr?.message ?? "Could not create account." };
  }
  const userId = created.user.id;

  const cleanup = async (message: string): Promise<SignupResult> => {
    await admin.auth.admin.deleteUser(userId);
    return { ok: false, error: message };
  };

  const { error: profileErr } = await admin.from("profiles").insert({
    id: userId,
    full_name: fullName,
    email: lowerEmail,
    phone: input.phone || null,
    location: input.location || null,
    whatsapp_number: input.whatsappNumber || null,
  });
  if (profileErr) return cleanup(profileErr.message);

  const { error: roleErr } = await admin
    .from("user_roles")
    .insert({ user_id: userId, role: "member" });
  if (roleErr) return cleanup(roleErr.message);

  const memberships = [
    { subunit_id: primarySubunitId, user_id: userId, membership_type: "primary" as const },
    // At most 3 secondary subunits (4 total, incl. the primary).
    ...input.secondarySubunitIds
      .filter((id) => id && id !== primarySubunitId)
      .slice(0, 3)
      .map((id) => ({ subunit_id: id, user_id: userId, membership_type: "secondary" as const })),
  ];
  const { error: memberErr } = await admin.from("subunit_members").insert(memberships);
  if (memberErr) return cleanup(memberErr.message);

  await enrollPrimaryCourses(admin, userId, primarySubunitId);

  // NOTE: self sign-ups are NOT flagged as new members — they're existing team
  // members claiming/registering. Only welfare-added people become new-member
  // welfare follow-ups (see welfare addNewMember).

  return { ok: true, signInEmail: lowerEmail };
}
