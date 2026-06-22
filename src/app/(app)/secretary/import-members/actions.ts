"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getSessionRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSheetRows } from "@/lib/attendance-parser";
import { fetchSheetAsBuffer } from "@/lib/google-sheets";
import { mapMemberColumns, mapSubunitValues, type MemberColumnMap } from "@/lib/import-mapper";
import { ACCEPTED_UPLOAD_EXT, MAX_UPLOAD_BYTES } from "@/lib/constants";

async function isSecretary() {
  const session = await getSessionRoles();
  return !!session && (session.roles.includes("secretary") || session.roles.includes("super_admin"));
}

/** Reads a value from a row by trying several possible header names (case-insensitive). */
function field(lookup: Record<string, string>, names: string[]): string {
  for (const n of names) {
    const v = lookup[n.toLowerCase()];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/** Prefer the AI-mapped column for a field; fall back to header guesses. */
function pick(lookup: Record<string, string>, mappedHeader: string | undefined, heuristics: string[]): string {
  if (mappedHeader) {
    const v = lookup[mappedHeader.trim().toLowerCase()];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return field(lookup, heuristics);
}

const firstToken = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0] ?? "";

/** Tolerant subunit match: exact name/slug, partial contains, then first-word. */
function matchSubunit(subunits: { id: string; name: string; slug: string }[], value: string): string | undefined {
  const v = value.trim().toLowerCase();
  if (!v) return undefined;
  for (const s of subunits) if (s.name.toLowerCase() === v || s.slug.toLowerCase() === v) return s.id;
  for (const s of subunits) {
    const n = s.name.toLowerCase();
    if (v.includes(n) || n.includes(v)) return s.id;
  }
  // First significant word (e.g. "Utility (Technical in Media)" → "Utility …").
  const ft = firstToken(v);
  if (ft.length > 2) {
    for (const s of subunits) if (firstToken(s.name) === ft) return s.id;
  }
  return undefined;
}

export interface ImportResult {
  created: number;
  skipped: { row: number; name: string; reason: string }[];
  /** Set when the whole import failed (e.g. sheet not shared) — friendly message. */
  error?: string;
}

/**
 * Bulk-creates member accounts from a spreadsheet (file or Google Sheet link).
 * Columns can be messy — AI maps them. Returns a result (never throws) so the
 * UI can show a clear reason instead of a masked server error.
 */
export async function importMembers(formData: FormData): Promise<ImportResult> {
  const empty: ImportResult = { created: 0, skipped: [] };
  try {
    if (!(await isSecretary())) return { ...empty, error: "Secretary access required." };

    const file = formData.get("file") as File | null;
    const sheetUrl = String(formData.get("sheetUrl") ?? "").trim();
    const defaultSubunitId = String(formData.get("defaultSubunitId") ?? "").trim();

    let buffer: Buffer;
    if (sheetUrl) {
      buffer = await fetchSheetAsBuffer(sheetUrl);
    } else if (file) {
      const name = file.name.toLowerCase();
      if (!ACCEPTED_UPLOAD_EXT.some((ext) => name.endsWith(ext))) {
        return { ...empty, error: "Please upload a .xlsx or .csv file." };
      }
      if (file.size > MAX_UPLOAD_BYTES) return { ...empty, error: "File exceeds the 5MB limit." };
      buffer = Buffer.from(await file.arrayBuffer());
    } else {
      return { ...empty, error: "Upload a file or paste a Google Sheet link." };
    }

    const admin = createAdminClient();
    const rows = readSheetRows(buffer);
    if (rows.length === 0) {
      return { ...empty, error: "That sheet looks empty — check the link/file and try again." };
    }

    const { data: subunitsData } = await admin.from("subunits").select("id, name, slug");
    const subunits = subunitsData ?? [];

    // Let AI figure out which columns are which; fall back to header guesses.
    const headers = Object.keys(rows[0]);
    let colMap: MemberColumnMap | null = null;
    try {
      colMap = await mapMemberColumns(headers, rows.slice(0, 5));
    } catch {
      colMap = null;
    }

    // AI-map the distinct subunit values in the sheet to our existing subunits,
    // so messy names ("Utility (Technical in Media)") still match.
    const distinctSubunitValues = new Set<string>();
    for (const r of rows) {
      const lk: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) lk[k.trim().toLowerCase()] = String(v ?? "");
      const pv = pick(lk, colMap?.primary_subunit, ["primary subunit", "subunit", "primary unit", "unit"]);
      if (pv) distinctSubunitValues.add(pv);
    }
    let aiSubunitMap: Record<string, string> = {};
    try {
      aiSubunitMap = await mapSubunitValues([...distinctSubunitValues], subunits.map((s) => s.name));
    } catch {
      aiSubunitMap = {};
    }

    const resolveSubunit = (value: string): string | undefined => {
      const direct = matchSubunit(subunits, value);
      if (direct) return direct;
      const mapped = aiSubunitMap[value.trim().toLowerCase()];
      return mapped ? matchSubunit(subunits, mapped) : undefined;
    };

    const result: ImportResult = { created: 0, skipped: [] };

    for (let i = 0; i < rows.length; i++) {
      const lookup: Record<string, string> = {};
      for (const [k, v] of Object.entries(rows[i])) lookup[k.trim().toLowerCase()] = String(v ?? "");

      const fullName = pick(lookup, colMap?.full_name, ["full name", "name", "fullname", "member"]);
      const email = pick(lookup, colMap?.email, ["email", "email address"]).toLowerCase();
      const phone = pick(lookup, colMap?.phone, ["phone", "phone number"]);
      const whatsapp = pick(lookup, colMap?.whatsapp, ["whatsapp", "whatsapp number", "wa"]);
      const primaryName = pick(lookup, colMap?.primary_subunit, ["primary subunit", "subunit", "primary unit", "unit", "department", "dept", "team", "section", "media unit", "unit of service", "portfolio", "group"]);
      const secondaryRaw = pick(lookup, colMap?.secondary_subunits, ["secondary subunits", "secondary", "other subunits"]);

      const rowNum = i + 2;
      if (!fullName) {
        result.skipped.push({ row: rowNum, name: "(no name)", reason: "no name found in the row" });
        continue;
      }
      // A member can belong to up to 4 subunits (1 home + up to 3 more), read
      // from the subunit column(s); values may be comma/semicolon/slash separated.
      const unitValues = [primaryName, secondaryRaw]
        .join(",")
        .split(/[,;/]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const matchedIds: string[] = [];
      for (const val of unitValues) {
        const id = resolveSubunit(val);
        if (id && !matchedIds.includes(id)) matchedIds.push(id);
      }
      if (matchedIds.length === 0 && defaultSubunitId) matchedIds.push(defaultSubunitId);
      if (matchedIds.length === 0) {
        result.skipped.push({
          row: rowNum,
          name: fullName,
          reason: primaryName
            ? `unknown subunit "${primaryName}" (or set a default subunit)`
            : "no subunit — set a default subunit above",
        });
        continue;
      }
      const capped = matchedIds.slice(0, 4); // at most four
      const primaryId = capped[0];
      const secondaryIds = capped.slice(1);

      // Skip if already in the system (by email if present, else by phone).
      if (email) {
        const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
        if (existing) {
          result.skipped.push({ row: rowNum, name: fullName, reason: "already exists" });
          continue;
        }
      }
      const phoneKey = (whatsapp || phone).replace(/[^\d+]/g, "");
      if (phoneKey) {
        const { data: existingPhone } = await admin
          .from("profiles")
          .select("id")
          .or(`whatsapp_number.eq.${phoneKey},phone.eq.${phoneKey}`)
          .limit(1);
        if (existingPhone && existingPhone.length) {
          result.skipped.push({ row: rowNum, name: fullName, reason: "already exists (phone match)" });
          continue;
        }
      }

      // Email is optional — generate a placeholder they replace at signup.
      const accountEmail = email || `nm-${randomUUID()}@no-email.ideal-media.app`;

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: accountEmail,
        password: randomUUID(),
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (createErr || !created.user) {
        result.skipped.push({ row: rowNum, name: fullName, reason: createErr?.message ?? "could not create" });
        continue;
      }
      const userId = created.user.id;

      const { error: profErr } = await admin.from("profiles").insert({
        id: userId,
        full_name: fullName,
        email: accountEmail,
        phone: phone || null,
        whatsapp_number: whatsapp || null,
        member_status: "active",
        claimed: false,
      });
      if (profErr) {
        await admin.auth.admin.deleteUser(userId);
        result.skipped.push({ row: rowNum, name: fullName, reason: profErr.message });
        continue;
      }

      await admin.from("user_roles").insert({ user_id: userId, role: "member" });

      const memberships: {
        user_id: string;
        subunit_id: string;
        membership_type: "primary" | "secondary";
      }[] = [
        { user_id: userId, subunit_id: primaryId, membership_type: "primary" },
        ...secondaryIds.map((id) => ({
          user_id: userId,
          subunit_id: id,
          membership_type: "secondary" as const,
        })),
      ];
      await admin.from("subunit_members").insert(memberships);

      result.created++;
    }

    // Clear top-level guidance when nothing imported.
    if (result.created === 0 && result.skipped.length > 0) {
      const noSubunit = result.skipped.filter((s) => s.reason.toLowerCase().includes("subunit")).length;
      result.error =
        noSubunit === result.skipped.length
          ? "No members created: I couldn't find a subunit/unit column in your sheet. Pick a “Default subunit” above and import again."
          : "No members were created — see the reasons listed below.";
    }

    revalidatePath("/secretary/roster");
    revalidatePath("/secretary");
    return result;
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) };
  }
}
