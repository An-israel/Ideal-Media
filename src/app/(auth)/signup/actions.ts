"use server";

import { createAdminClient } from "@/lib/supabase/admin";

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
}

/**
 * Provisions a new member (Section 6): auth user → profile → `member` role →
 * subunit_members (one primary + any secondaries) → a `new_member` welfare
 * followup. Runs with the admin client (privileged) after validating input.
 */
export async function signUpAction(input: SignupInput): Promise<SignupResult> {
  const { fullName, email, password, primarySubunitId } = input;

  if (!fullName.trim() || !email.trim() || !password) {
    return { ok: false, error: "Please fill in all required fields." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  if (!primarySubunitId) {
    return { ok: false, error: "Please select your primary subunit." };
  }

  const admin = createAdminClient();

  // De-duplication guard (Section: imported members). If someone is already in
  // the system — same email, or same phone/WhatsApp from a bulk import — don't
  // create a second account; point them at logging in instead.
  const { data: byEmail } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (byEmail) {
    return {
      ok: false,
      error: "You're already registered with this email. Please use Log in (or 'Forgot password' to set your password).",
    };
  }
  const phoneToCheck = input.whatsappNumber || input.phone;
  if (phoneToCheck) {
    const { data: byPhone } = await admin
      .from("profiles")
      .select("id")
      .or(`whatsapp_number.eq.${phoneToCheck},phone.eq.${phoneToCheck}`)
      .maybeSingle();
    if (byPhone) {
      return {
        ok: false,
        error: "It looks like you're already on the team (matched by phone number). Please use Log in, or 'Forgot password' if you've never set one.",
      };
    }
  }

  // Create the auth user (email pre-confirmed so they can sign in immediately).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
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
    email,
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
    ...input.secondarySubunitIds
      .filter((id) => id && id !== primarySubunitId)
      .map((id) => ({
        subunit_id: id,
        user_id: userId,
        membership_type: "secondary" as const,
      })),
  ];
  const { error: memberErr } = await admin.from("subunit_members").insert(memberships);
  if (memberErr) return cleanup(memberErr.message);

  // Auto-enroll into any already-published courses in the primary subunit
  // (Section 5: primary-subunit courses are auto-enrolled).
  const { data: primaryCourses } = await admin
    .from("courses")
    .select("id")
    .eq("subunit_id", primarySubunitId)
    .eq("is_published", true);
  if (primaryCourses && primaryCourses.length) {
    await admin.from("enrollments").upsert(
      primaryCourses.map((c) => ({
        user_id: userId,
        course_id: c.id,
        status: "enrolled" as const,
      })),
      { onConflict: "user_id,course_id", ignoreDuplicates: true }
    );
  }

  // Welfare sees every new member (Section 6 / 10).
  await admin
    .from("welfare_followups")
    .insert({ user_id: userId, reason: "new_member", auto_flagged: true });

  return { ok: true };
}
