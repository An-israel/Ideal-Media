"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getSessionRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSheetRows } from "@/lib/attendance-parser";
import { fetchSheetAsBuffer } from "@/lib/google-sheets";
import { mapMemberColumns, mapSubunitValues, type MemberColumnMap } from "@/lib/import-mapper";
import { fetchAllRows } from "@/lib/pagination";
import { parseBirthday } from "@/lib/dates";
import { phoneKey } from "@/lib/phone";
import {
  ACCEPTED_UPLOAD_EXT,
  MAX_UPLOAD_BYTES,
  MAX_SUBUNITS_PER_MEMBER,
} from "@/lib/constants";

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
function pick(
  lookup: Record<string, string>,
  mappedHeader: string | undefined,
  heuristics: string[]
): string {
  if (mappedHeader) {
    const v = lookup[mappedHeader.trim().toLowerCase()];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return field(lookup, heuristics);
}

const firstToken = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0] ?? "";

// Common wording differences → the app's subunit name.
const SUBUNIT_ALIASES: Record<string, string> = {
  "graphics design": "graphic design",
  "graphic designs": "graphic design",
  graphics: "graphic design",
  publicity: "publication",
  publications: "publication",
};

/** Tolerant subunit match: exact name/slug, partial contains, then first-word. */
function matchSubunit(
  subunits: { id: string; name: string; slug: string }[],
  value: string
): string | undefined {
  let v = value.trim().toLowerCase();
  if (!v) return undefined;
  if (SUBUNIT_ALIASES[v]) v = SUBUNIT_ALIASES[v];
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
  /** Workbook tabs that were read. */
  sheets?: string[];
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
    // Reads every sheet in the workbook, not just the first (AUDIT ATT-1).
    const rows = readSheetRows(buffer);
    if (rows.length === 0) {
      return { ...empty, error: "That sheet looks empty — check the link/file and try again." };
    }

    const { data: subunitsData } = await admin.from("subunits").select("id, name, slug");
    const subunits = subunitsData ?? [];

    // Existing members, read ONCE and paged (AUDIT PERF-2). The per-row
    // duplicate check was two queries per spreadsheet row against an unbounded
    // select that caps at 1000 — both slow and silently wrong past that.
    const existingProfiles = await fetchAllRows<{
      id: string;
      email: string | null;
      phone: string | null;
      whatsapp_number: string | null;
    }>((from, to) =>
      admin.from("profiles").select("id, email, phone, whatsapp_number").range(from, to)
    );
    const takenEmails = new Set<string>();
    const takenPhones = new Set<string>();
    for (const p of existingProfiles) {
      if (p.email) takenEmails.add(p.email.toLowerCase());
      for (const raw of [p.phone, p.whatsapp_number]) {
        const key = phoneKey(raw);
        if (key) takenPhones.add(key);
      }
    }

    // Let AI figure out which columns are which; fall back to header guesses.
    const headers = Object.keys(rows[0]).filter((h) => h !== "__sheet");
    let colMap: MemberColumnMap | null = null;
    try {
      colMap = await mapMemberColumns(headers, rows.slice(0, 5));
    } catch (e) {
      console.error("[import-members] column mapping failed:", e);
      colMap = null;
    }

    const toLookup = (row: Record<string, unknown>): Record<string, string> => {
      const lk: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        if (k === "__sheet") continue;
        lk[k.trim().toLowerCase()] = String(v ?? "");
      }
      return lk;
    };

    const SUBUNIT_HEADERS = [
      "primary subunit", "subunit", "primary unit", "unit", "department", "dept",
      "team", "section", "media unit", "unit of service", "portfolio", "group",
    ];

    // AI-map the distinct subunit values in the sheet to our existing subunits,
    // so messy names ("Utility (Technical in Media)") still match.
    const distinctSubunitValues = new Set<string>();
    for (const r of rows) {
      const pv = pick(toLookup(r), colMap?.primary_subunit, SUBUNIT_HEADERS);
      if (pv) distinctSubunitValues.add(pv);
    }
    let aiSubunitMap: Record<string, string> = {};
    try {
      aiSubunitMap = await mapSubunitValues(
        [...distinctSubunitValues],
        subunits.map((s) => s.name)
      );
    } catch (e) {
      console.error("[import-members] subunit mapping failed:", e);
      aiSubunitMap = {};
    }

    const resolveSubunit = (value: string): string | undefined => {
      const direct = matchSubunit(subunits, value);
      if (direct) return direct;
      const mapped = aiSubunitMap[value.trim().toLowerCase()];
      return mapped ? matchSubunit(subunits, mapped) : undefined;
    };

    const result: ImportResult = { created: 0, skipped: [], sheets: [] };
    const seenSheets = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const lookup = toLookup(rows[i]);
      const sheetName = String(rows[i].__sheet ?? "");
      if (sheetName) seenSheets.add(sheetName);
      const rowNum = i + 2;
      const rowLabel = sheetName ? `${sheetName} row ${rowNum}` : `row ${rowNum}`;

      const fullName = pick(lookup, colMap?.full_name, ["full name", "name", "fullname", "member"]);
      const email = pick(lookup, colMap?.email, ["email", "email address"]).toLowerCase();
      const phone = pick(lookup, colMap?.phone, ["phone", "phone number"]);
      const whatsapp = pick(lookup, colMap?.whatsapp, ["whatsapp", "whatsapp number", "wa"]);
      const primaryName = pick(lookup, colMap?.primary_subunit, SUBUNIT_HEADERS);
      const secondaryRaw = pick(lookup, colMap?.secondary_subunits, [
        "secondary subunits", "secondary", "other subunits",
      ]);
      // Day-first parsing (AUDIT ROS-6): the old helper assumed month/day, so
      // an ambiguous "6/7" was always read as June 7th, never July 6th — which
      // is backwards for how these sheets are written.
      const bday = parseBirthday(
        pick(lookup, colMap?.birthday, ["birthday", "birth day", "date of birth", "dob", "d.o.b"])
      );

      if (!fullName) {
        result.skipped.push({ row: rowNum, name: "(no name)", reason: `${rowLabel}: no name found` });
        continue;
      }

      // A member can belong to up to MAX_SUBUNITS_PER_MEMBER subunits (1 home +
      // the rest), read from the subunit column(s); values may be
      // comma/semicolon/slash separated.
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
            ? `${rowLabel}: unknown subunit "${primaryName}" (or set a default subunit)`
            : `${rowLabel}: no subunit — set a default subunit above`,
        });
        continue;
      }
      const capped = matchedIds.slice(0, MAX_SUBUNITS_PER_MEMBER);
      const primaryId = capped[0];
      const secondaryIds = capped.slice(1);

      // Skip if already in the system (by email if present, else by phone).
      // Checked against the in-memory index so a duplicate created earlier in
      // this same import is caught too.
      if (email && takenEmails.has(email)) {
        result.skipped.push({ row: rowNum, name: fullName, reason: `${rowLabel}: already exists` });
        continue;
      }
      const pKey = phoneKey(whatsapp || phone);
      if (pKey && takenPhones.has(pKey)) {
        result.skipped.push({
          row: rowNum,
          name: fullName,
          reason: `${rowLabel}: already exists (phone match)`,
        });
        continue;
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
        result.skipped.push({
          row: rowNum,
          name: fullName,
          reason: `${rowLabel}: ${createErr?.message ?? "could not create"}`,
        });
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
        member_origin: "import",
        birth_month: bday?.month ?? null,
        birth_day: bday?.day ?? null,
      });
      if (profErr) {
        // Roll the auth user back so it can't become an invisible orphan.
        const { error: delErr } = await admin.auth.admin.deleteUser(userId);
        if (delErr) {
          console.error(
            `[import-members] orphaned auth user ${userId} (${accountEmail}):`,
            delErr.message
          );
        }
        result.skipped.push({ row: rowNum, name: fullName, reason: `${rowLabel}: ${profErr.message}` });
        continue;
      }

      const { error: roleErr } = await admin
        .from("user_roles")
        .insert({ user_id: userId, role: "member" });
      if (roleErr) {
        console.error(`[import-members] could not grant member role to ${userId}:`, roleErr.message);
      }

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
      const { error: memberErr } = await admin.from("subunit_members").insert(memberships);
      if (memberErr) {
        console.error(
          `[import-members] could not add ${userId} to subunit(s):`,
          memberErr.message
        );
        result.skipped.push({
          row: rowNum,
          name: fullName,
          reason: `${rowLabel}: created, but subunit assignment failed — ${memberErr.message}`,
        });
        continue;
      }

      // Keep the in-memory index current so later rows see this member.
      if (email) takenEmails.add(email);
      if (pKey) takenPhones.add(pKey);

      result.created++;
    }

    result.sheets = [...seenSheets];

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
