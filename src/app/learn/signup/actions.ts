"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/phone";
import { learnerMigrations } from "@/lib/schema-check";

/**
 * Creating a course-only learner account.
 *
 * Writes a login and a `learners` row, and nothing else. It never creates a
 * profile, never adds a subunit or a role, and never notifies the secretary or
 * welfare — a learner is not joining the department, and none of the
 * department's records should change when one signs up.
 */

export interface LearnerSignupInput {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  /** A field real people never see. Anything in it is a bot. */
  website?: string;
}

export interface LearnerSignupResult {
  ok: boolean;
  error?: string;
  signInEmail?: string;
  needsEmailConfirmation?: boolean;
}

/**
 * New learner accounts allowed per hour, across the whole site.
 *
 * The page is public and the account is created with the service role, which
 * Supabase does not rate-limit. Without a ceiling, a script could fill the
 * login table with thousands of accounts in a minute. A real surge of learners
 * an hour is far below this; a bot is far above it.
 */
const MAX_SIGNUPS_PER_HOUR = 40;

const requireEmailConfirmation = () => process.env.REQUIRE_EMAIL_CONFIRMATION === "true";

export async function signUpLearner(input: LearnerSignupInput): Promise<LearnerSignupResult> {
  // Answer a bot exactly as a person would be answered, so it learns nothing.
  if (input.website?.trim()) return { ok: true, signInEmail: input.email.trim().toLowerCase() };

  const fullName = input.fullName.trim().replace(/\s+/g, " ");
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  const phoneRaw = input.phone.trim();

  if (fullName.length < 2 || fullName.length > 80) {
    return { ok: false, error: "Please enter your full name — it is the name printed on your certificates." };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "That email address doesn't look right." };
  }
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
  if (phoneRaw && !normalizePhone(phoneRaw)) {
    return { ok: false, error: "That phone number doesn't look right." };
  }

  try {
    if ((await learnerMigrations()).length > 0) {
      return { ok: false, error: "Sign-up for the courses isn't open yet. Please try again later." };
    }
  } catch {
    return { ok: false, error: "Sign-up for the courses isn't open yet. Please try again later." };
  }

  const admin = createAdminClient();

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count: recent } = await admin
    .from("learners")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if ((recent ?? 0) >= MAX_SIGNUPS_PER_HOUR) {
    return { ok: false, error: "A lot of people are signing up right now. Please try again in an hour." };
  }

  // Somebody already in the media department has the academy inside their own
  // account. Making them a second, course-only login would split their
  // progress across two accounts and confuse which one is "them".
  const { data: member } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (member) {
    return {
      ok: false,
      error:
        "This email belongs to a member of the media department. Log in instead — the courses are in your Skills Academy.",
    };
  }

  const { data: existing } = await admin
    .from("learners")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (existing) {
    return { ok: false, error: "You already have an account. Log in, or use “Forgot password”." };
  }

  const mustConfirm = requireEmailConfirmation();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: !mustConfirm,
    user_metadata: { full_name: fullName, account: "learner" },
  });
  if (createErr || !created.user) {
    const msg = createErr?.message ?? "";
    if (/already|registered|exists/i.test(msg)) {
      return { ok: false, error: "An account already uses this email. Log in, or use “Forgot password”." };
    }
    return { ok: false, error: msg || "Could not create your account." };
  }
  const userId = created.user.id;

  const { error: rowErr } = await admin.from("learners").insert({
    id: userId,
    full_name: fullName,
    email,
    phone: phoneRaw || null,
  });
  if (rowErr) {
    // Never leave a login with no learner row: it would be signed in as nobody.
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.error(`[learn] orphaned auth user ${userId} — rollback failed:`, error.message);
    return { ok: false, error: "Could not create your account. Please try again." };
  }

  if (mustConfirm) {
    const { error: linkErr } = await admin.auth.admin.generateLink({
      type: "signup",
      email,
      password,
    });
    if (linkErr) console.error("[learn] could not send confirmation email:", linkErr.message);
    return { ok: true, signInEmail: email, needsEmailConfirmation: true };
  }

  return { ok: true, signInEmail: email };
}
