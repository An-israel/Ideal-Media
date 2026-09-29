"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/pagination";
import { notifyRole } from "@/lib/notify";
import { phoneKey } from "@/lib/phone";
import { MAX_SUBUNITS_PER_MEMBER } from "@/lib/constants";
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
  /** True when Supabase is configured to require email confirmation first. */
  needsEmailConfirmation?: boolean;
}

type AdminClient = ReturnType<typeof createAdminClient>;

/** Placeholder address given to members added without a real email. */
const PLACEHOLDER_EMAIL_DOMAIN = "@no-email.ideal-media.app";
const isPlaceholderEmail = (email: string) => email.endsWith(PLACEHOLDER_EMAIL_DOMAIN);

/**
 * Whether a brand-new self-signup must confirm their email before signing in
 * (AUDIT AUTH-4).
 *
 * Accounts are created with `email_confirm: true`, which marks the address
 * verified without ever sending anything — so anyone can register under someone
 * else's email. The correct fix needs working SMTP in the Supabase project;
 * turning it on without that would lock everyone out of a working app. So it is
 * opt-in: set REQUIRE_EMAIL_CONFIRMATION=true once Supabase can send mail.
 *
 * Note this only affects NEW accounts. Claiming an imported roster record still
 * works without it, and is separately hardened by the name check below.
 */
const requireEmailConfirmation = () =>
  process.env.REQUIRE_EMAIL_CONFIRMATION === "true";

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

/** Comparable name tokens, e.g. "Chidi  A. Okeke" → ["chidi","okeke"]. */
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 1);
}

/**
 * Does the claimed name plausibly match the name on record?
 *
 * Part of hardening claim-by-phone (AUDIT SEC-5). A phone number alone used to
 * be enough to take over any unclaimed account — set a password on it, move the
 * login email to yours, done. Phone numbers are semi-public in a church
 * context, so an attacker needed only that one fact. Requiring the name as well
 * means a claimant has to know two things about the person, while a genuine
 * member claiming their own record still sails through.
 *
 * Deliberately lenient about order, middle names and extra initials: it must
 * not block real people.
 */
function nameMatches(claimed: string, onRecord: string): boolean {
  const a = new Set(nameTokens(claimed));
  const b = nameTokens(onRecord);
  if (a.size === 0 || b.length === 0) return false;
  const overlap = b.filter((t) => a.has(t)).length;
  // At least two shared name parts, or a full match on a single-word name.
  return overlap >= Math.min(2, b.length);
}

/**
 * Sign up (Section 6) with claim-by-phone for imported members. If a person's
 * details match a pre-imported, unclaimed record (by email, or by phone AND
 * name), we set their chosen password on that record and attach it — no
 * password-reset email. Otherwise we create a fresh account.
 */
export async function signUpAction(input: SignupInput): Promise<SignupResult> {
  const { fullName, email, password, primarySubunitId } = input;
  const lowerEmail = email.trim().toLowerCase();
  const trimmedName = fullName.trim();

  if (!trimmedName || !lowerEmail || !password) {
    return { ok: false, error: "Please fill in all required fields." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  if (!primarySubunitId) {
    return { ok: false, error: "Please select your primary subunit." };
  }

  const admin = createAdminClient();
  const key = phoneKey(input.whatsappNumber || input.phone || "");

  // Pull existing members and match by email, then by phone (in code, so phone
  // formatting differences don't cause a miss → no accidental duplicate).
  //
  // Paged (AUDIT ROS-3): this was an unbounded select, which PostgREST caps at
  // 1000 rows with no error. Past 1000 members, anyone outside that window
  // wasn't matched, so instead of claiming their imported record they got a
  // brand-new duplicate account and lost all their history.
  const allProfiles = await fetchAllRows<{
    id: string;
    email: string;
    full_name: string;
    phone: string | null;
    whatsapp_number: string | null;
    claimed: boolean;
  }>((from, to) =>
    admin
      .from("profiles")
      .select("id, email, full_name, phone, whatsapp_number, claimed")
      .order("created_at", { ascending: true })
      .range(from, to)
  );

  type Match = {
    id: string;
    email: string;
    full_name: string;
    claimed: boolean;
    via: "email" | "phone";
  };

  let match: Match | null = null;
  for (const p of allProfiles) {
    if (p.email && p.email.toLowerCase() === lowerEmail) {
      match = { ...p, via: "email" };
      break;
    }
  }
  if (!match && key) {
    for (const p of allProfiles) {
      if (phoneKey(p.phone) === key || phoneKey(p.whatsapp_number) === key) {
        match = { ...p, via: "phone" };
        break;
      }
    }
  }

  // ---- Already a real (claimed) account ----
  if (match && match.claimed) {
    return {
      ok: false,
      error: "You're already registered. Please use Log in instead.",
    };
  }

  // ---- Claim an imported, unclaimed record ----
  if (match && !match.claimed) {
    // A phone-only match must also match the name on record (AUDIT SEC-5).
    if (match.via === "phone" && !nameMatches(trimmedName, match.full_name)) {
      return {
        ok: false,
        error:
          "That phone number is already on our roster under a different name. If it's yours, ask a secretary to confirm your details.",
      };
    }

    // Never silently move the login email off an account that has a REAL one.
    // That was the takeover step: match on phone, then redirect the account's
    // email to the attacker's. Accounts added without an email (placeholder
    // address) can still adopt the one typed at signup.
    const recordHasRealEmail = !isPlaceholderEmail(match.email);
    const wantsDifferentEmail = lowerEmail !== match.email.toLowerCase();

    if (recordHasRealEmail && wantsDifferentEmail) {
      return {
        ok: false,
        error: `We already have an account for you under a different email address. Sign up with that address, or use "Forgot password" to recover it.`,
      };
    }

    let signInEmail = match.email;
    let claimErr: string | null = null;

    if (wantsDifferentEmail) {
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
    if (trimmedName) update.full_name = trimmedName;
    if (input.location) update.location = input.location;
    if (input.whatsappNumber) update.whatsapp_number = input.whatsappNumber;
    if (input.phone) update.phone = input.phone;
    await admin.from("profiles").update(update).eq("id", match.id);

    await admin
      .from("user_roles")
      .upsert(
        { user_id: match.id, role: "member" },
        { onConflict: "user_id,role", ignoreDuplicates: true }
      );

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

    // Make the claim visible so a wrongful one can be caught and reversed
    // (AUDIT SEC-5). A silent account takeover leaves no trace at all.
    await notifyRole("secretary", {
      type: "member_claimed",
      title: "Roster record claimed",
      body: `${trimmedName} claimed the roster record for ${match.full_name} (matched by ${match.via}).`,
      link: "/secretary/roster",
    });

    // No new_member welfare flag — they're an existing member.
    return { ok: true, signInEmail };
  }

  // ---- Brand-new member ----
  const mustConfirm = requireEmailConfirmation();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: lowerEmail,
    password,
    email_confirm: !mustConfirm,
    user_metadata: { full_name: trimmedName },
  });
  if (createErr || !created.user) {
    return { ok: false, error: createErr?.message ?? "Could not create account." };
  }
  const userId = created.user.id;

  const cleanup = async (message: string): Promise<SignupResult> => {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      console.error(`[signup] orphaned auth user ${userId} — rollback failed:`, error.message);
    }
    return { ok: false, error: message };
  };

  const { error: profileErr } = await admin.from("profiles").insert({
    id: userId,
    full_name: trimmedName,
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
    // Up to the subunit cap in total, including the primary.
    ...input.secondarySubunitIds
      .filter((id) => id && id !== primarySubunitId)
      .slice(0, MAX_SUBUNITS_PER_MEMBER - 1)
      .map((id) => ({ subunit_id: id, user_id: userId, membership_type: "secondary" as const })),
  ];
  const { error: memberErr } = await admin.from("subunit_members").insert(memberships);
  if (memberErr) return cleanup(memberErr.message);

  await enrollPrimaryCourses(admin, userId, primarySubunitId);

  // NOTE: self sign-ups are NOT flagged as new members — they're existing team
  // members claiming/registering. Only welfare-added people become new-member
  // welfare follow-ups (see welfare addNewMember).

  if (mustConfirm) {
    // Ask Supabase to send the confirmation mail. Best-effort: the account
    // exists either way, and they can use "Forgot password" to get in.
    const { error: linkErr } = await admin.auth.admin.generateLink({
      type: "signup",
      email: lowerEmail,
      password,
    });
    if (linkErr) {
      console.error("[signup] could not send confirmation email:", linkErr.message);
    }
    return { ok: true, signInEmail: lowerEmail, needsEmailConfirmation: true };
  }

  return { ok: true, signInEmail: lowerEmail };
}
