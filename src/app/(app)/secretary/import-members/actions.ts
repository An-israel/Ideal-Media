"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getSessionRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSheetRows } from "@/lib/attendance-parser";
import { ACCEPTED_UPLOAD_EXT, MAX_UPLOAD_BYTES } from "@/lib/constants";

async function requireSecretary() {
  const session = await getSessionRoles();
  if (!session) throw new Error("Not authenticated");
  if (!session.roles.includes("secretary") && !session.roles.includes("super_admin")) {
    throw new Error("Secretary access required");
  }
}

/** Reads a value from a row by trying several possible header names (case-insensitive). */
function field(lookup: Record<string, string>, names: string[]): string {
  for (const n of names) {
    const v = lookup[n.toLowerCase()];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

export interface ImportResult {
  created: number;
  skipped: { row: number; name: string; reason: string }[];
}

/**
 * Bulk-creates member accounts from a spreadsheet so the whole team is in the
 * system at once. Expected columns (case-insensitive, extras ignored):
 *   Full Name | Email | Phone | WhatsApp | Primary Subunit | Secondary Subunits
 * Each person sets their own password later via "Forgot password".
 */
export async function importMembers(formData: FormData): Promise<ImportResult> {
  await requireSecretary();

  const file = formData.get("file") as File | null;
  if (!file) throw new Error("No file provided.");
  const name = file.name.toLowerCase();
  if (!ACCEPTED_UPLOAD_EXT.some((ext) => name.endsWith(ext))) {
    throw new Error("Please upload a .xlsx or .csv file.");
  }
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("File exceeds the 5MB limit.");

  const admin = createAdminClient();
  const rows = readSheetRows(Buffer.from(await file.arrayBuffer()));

  const { data: subunits } = await admin.from("subunits").select("id, name, slug");
  const subunitByName = new Map<string, string>();
  for (const s of subunits ?? []) {
    subunitByName.set(s.name.toLowerCase(), s.id);
    subunitByName.set(s.slug.toLowerCase(), s.id);
  }

  const result: ImportResult = { created: 0, skipped: [] };

  for (let i = 0; i < rows.length; i++) {
    const lookup: Record<string, string> = {};
    for (const [k, v] of Object.entries(rows[i])) lookup[k.trim().toLowerCase()] = String(v ?? "");

    const fullName = field(lookup, ["full name", "name", "fullname", "member"]);
    const email = field(lookup, ["email", "email address"]).toLowerCase();
    const phone = field(lookup, ["phone", "phone number"]);
    const whatsapp = field(lookup, ["whatsapp", "whatsapp number", "wa"]);
    const primaryName = field(lookup, ["primary subunit", "subunit", "primary unit", "unit"]);
    const secondaryRaw = field(lookup, ["secondary subunits", "secondary", "other subunits"]);

    const rowNum = i + 2; // +1 for header, +1 for 1-based
    if (!fullName || !email) {
      result.skipped.push({ row: rowNum, name: fullName || "(no name)", reason: "missing name or email" });
      continue;
    }
    const primaryId = subunitByName.get(primaryName.toLowerCase());
    if (!primaryId) {
      result.skipped.push({ row: rowNum, name: fullName, reason: `unknown subunit "${primaryName}"` });
      continue;
    }

    // Already in the system?
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existing) {
      result.skipped.push({ row: rowNum, name: fullName, reason: "already exists" });
      continue;
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: randomUUID(),
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createErr || !created.user) {
      result.skipped.push({ row: rowNum, name: fullName, reason: createErr?.message ?? "could not create" });
      continue;
    }
    const userId = created.user.id;

    await admin.from("profiles").insert({
      id: userId,
      full_name: fullName,
      email,
      phone: phone || null,
      whatsapp_number: whatsapp || null,
      member_status: "active",
      // Unclaimed: no usable password yet. The person claims it by signing up
      // with a matching phone/email and choosing their own password.
      claimed: false,
    });
    await admin.from("user_roles").insert({ user_id: userId, role: "member" });

    const memberships: {
      user_id: string;
      subunit_id: string;
      membership_type: "primary" | "secondary";
    }[] = [{ user_id: userId, subunit_id: primaryId, membership_type: "primary" }];
    if (secondaryRaw) {
      for (const sName of secondaryRaw.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
        const sid = subunitByName.get(sName.toLowerCase());
        if (sid && sid !== primaryId) {
          memberships.push({ user_id: userId, subunit_id: sid, membership_type: "secondary" });
        }
      }
    }
    await admin.from("subunit_members").insert(memberships);

    result.created++;
  }

  revalidatePath("/secretary/roster");
  return result;
}
