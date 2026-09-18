import "server-only";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/pagination";
import { phoneKey } from "@/lib/phone";

export interface NewMemberRecord {
  fullName: string;
  email: string;
  phone: string;
  whatsappNumber: string;
  primarySubunitId: string;
  /** How they entered the system. Preserved after they claim the account. */
  origin: "welfare" | "secretary" | "import";
  birthMonth?: number | null;
  birthDay?: number | null;
}

export interface CreateMemberResult {
  userId: string;
}

/**
 * Finds an existing member by email or phone, paging through profiles.
 *
 * The callers used `.eq(...)`/`.or(...)` queries against an unbounded select,
 * which PostgREST caps at 1000 rows with no error — so past 1000 members the
 * duplicate check silently passed and created a second account (AUDIT ROS-3).
 *
 * Phone comparison is on the normalised subscriber digits, so "08031234567"
 * and "+2348031234567" are recognised as the same person.
 */
export async function findExistingMember(input: {
  email?: string;
  phone?: string;
  whatsappNumber?: string;
}): Promise<{ id: string; reason: "email" | "phone" } | null> {
  const admin = createAdminClient();
  const email = input.email?.trim().toLowerCase() || null;
  const key = phoneKey(input.whatsappNumber || input.phone || null);
  if (!email && !key) return null;

  const profiles = await fetchAllRows<{
    id: string;
    email: string | null;
    phone: string | null;
    whatsapp_number: string | null;
  }>((from, to) =>
    admin.from("profiles").select("id, email, phone, whatsapp_number").range(from, to)
  );

  if (email) {
    const hit = profiles.find((p) => p.email && p.email.toLowerCase() === email);
    if (hit) return { id: hit.id, reason: "email" };
  }
  if (key) {
    const hit = profiles.find(
      (p) => phoneKey(p.phone) === key || phoneKey(p.whatsapp_number) === key
    );
    if (hit) return { id: hit.id, reason: "phone" };
  }
  return null;
}

/**
 * Creates an unclaimed member record: an auth user (so the person can later
 * claim it by signing up), a profile, a `member` role, and a primary
 * membership.
 *
 * Every step is checked and the auth user is deleted if anything after it fails
 * (AUDIT ROS-2). The welfare and roster paths previously called
 * `auth.admin.createUser` and then `profiles.insert` without checking the
 * insert result or rolling back, leaving a login with no profile: invisible in
 * every UI (they all read `profiles`), undetectable by the duplicate-email
 * check (which also reads `profiles`), but still holding the email in
 * `auth.users` — so the next attempt failed with a confusing
 * "email already registered".
 */
export async function createUnclaimedMember(
  input: NewMemberRecord
): Promise<CreateMemberResult> {
  const admin = createAdminClient();

  const fullName = input.fullName.trim();
  if (!fullName) throw new Error("Name is required.");
  if (!input.primarySubunitId) throw new Error("Please choose a primary subunit.");

  const existing = await findExistingMember(input);
  if (existing) {
    throw new Error(
      existing.reason === "email"
        ? "Someone with that email is already in the system."
        : "Someone with that phone number is already in the system."
    );
  }

  // Real email if known, otherwise a placeholder they replace when they claim.
  const email =
    input.email.trim().toLowerCase() || `nm-${randomUUID()}@no-email.ideal-media.app`;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: randomUUID(),
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createErr || !created.user) {
    throw new Error(createErr?.message ?? "Could not add member.");
  }
  const userId = created.user.id;

  // Any failure past this point leaves an orphaned login, so unwind it.
  const rollback = async (message: string): Promise<never> => {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      console.error(
        `[member-admin] orphaned auth user ${userId} (${email}) — rollback failed:`,
        error.message
      );
    }
    throw new Error(message);
  };

  const { error: profileErr } = await admin.from("profiles").insert({
    id: userId,
    full_name: fullName,
    email,
    phone: input.phone || null,
    whatsapp_number: input.whatsappNumber || null,
    member_status: "active",
    claimed: false,
    member_origin: input.origin,
    birth_month: input.birthMonth ?? null,
    birth_day: input.birthDay ?? null,
  });
  if (profileErr) return rollback(profileErr.message);

  const { error: roleErr } = await admin
    .from("user_roles")
    .insert({ user_id: userId, role: "member" });
  if (roleErr) return rollback(roleErr.message);

  const { error: membershipErr } = await admin.from("subunit_members").insert({
    user_id: userId,
    subunit_id: input.primarySubunitId,
    membership_type: "primary",
  });
  if (membershipErr) return rollback(membershipErr.message);

  return { userId };
}
