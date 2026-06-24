"use server";

import { revalidatePath } from "next/cache";
import { getSessionRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  readSheetRows,
  readBestRegisterMatrix,
  monthFromHeader,
  normalizeStatus,
} from "@/lib/attendance-parser";
import { fetchSheetAsBuffer } from "@/lib/google-sheets";
import { mapAttendanceColumns, type AttendanceColumnMap } from "@/lib/import-mapper";
import { recomputeMissedService } from "@/lib/welfare-automation";
import { ACCEPTED_UPLOAD_EXT, MAX_UPLOAD_BYTES } from "@/lib/constants";
import type { AttendanceStatus } from "@/lib/database.types";

async function isSecretary() {
  const session = await getSessionRoles();
  return !!session && (session.roles.includes("secretary") || session.roles.includes("super_admin"));
}

function field(lookup: Record<string, unknown>, names: string[]): unknown {
  for (const n of names) {
    const v = lookup[n.toLowerCase()];
    if (v != null && String(v).trim() !== "") return v;
  }
  return "";
}

/** Prefer the AI-mapped column, fall back to header guesses. */
function pick(lookup: Record<string, unknown>, mappedHeader: string | undefined, heuristics: string[]): unknown {
  if (mappedHeader) {
    const v = lookup[mappedHeader.trim().toLowerCase()];
    if (v != null && String(v).trim() !== "") return v;
  }
  return field(lookup, heuristics);
}

/** Coerces a cell to a YYYY-MM-DD date string, or null if it can't. */
function coerceDate(value: unknown): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export interface AttendanceImportResult {
  imported: number;
  skipped: { row: number; reason: string }[];
  /** Number of monthly tallies imported (e.g. "5 in March"). */
  summaries?: number;
  /** Set when the whole import failed — friendly message. */
  error?: string;
}

/**
 * Imports historical attendance from a spreadsheet (file or Google Sheet link).
 * Columns can be messy — AI maps them. The activity is chosen in the UI and
 * applies to every row. Returns a result (never throws) so the UI shows a clear
 * reason instead of a masked server error.
 */
export async function importPastAttendance(formData: FormData): Promise<AttendanceImportResult> {
  const empty: AttendanceImportResult = { imported: 0, skipped: [] };
  try {
  if (!(await isSecretary())) return { ...empty, error: "Secretary access required." };

  const file = formData.get("file") as File | null;
  const sheetUrl = String(formData.get("sheetUrl") ?? "").trim();
  const activityId = String(formData.get("activityId") ?? "");
  if (!activityId) return { ...empty, error: "Pick an activity." };

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
  if (rows.length === 0) return { ...empty, error: "That sheet looks empty — check the link/file." };

  const { data: profiles } = await admin.from("profiles").select("id, email, full_name");
  const byEmail = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const p of profiles ?? []) {
    if (p.email) byEmail.set(p.email.toLowerCase(), p.id);
    byName.set(p.full_name.toLowerCase(), p.id);
  }

  // Let AI map the columns (the sheet's headers may be messy/unexpected).
  const headers = rows.length ? Object.keys(rows[0]) : [];
  let colMap: AttendanceColumnMap | null = null;
  try {
    colMap = await mapAttendanceColumns(headers, rows.slice(0, 5));
  } catch {
    colMap = null;
  }

  const result: AttendanceImportResult = { imported: 0, skipped: [] };
  const records: {
    user_id: string;
    activity_id: string;
    service_date: string;
    status: AttendanceStatus;
    source: "manual";
  }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const lookup: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rows[i])) lookup[k.trim().toLowerCase()] = v;
    const rowNum = i + 2;

    const email = String(pick(lookup, colMap?.email, ["email", "email address"])).toLowerCase().trim();
    const memberName = String(pick(lookup, colMap?.name, ["name", "full name", "member"])).trim();
    const userId = (email && byEmail.get(email)) || (memberName && byName.get(memberName.toLowerCase()));
    if (!userId) {
      result.skipped.push({ row: rowNum, reason: `no member match (${email || memberName || "blank"})` });
      continue;
    }

    const date = coerceDate(pick(lookup, colMap?.date, ["date", "service date", "day"]));
    if (!date) {
      result.skipped.push({ row: rowNum, reason: "unreadable date" });
      continue;
    }

    const status = normalizeStatus(String(pick(lookup, colMap?.status, ["status", "attendance", "present"])));
    records.push({ user_id: userId, activity_id: activityId, service_date: date, status, source: "manual" });
  }

  if (records.length) {
    const { error } = await admin
      .from("attendance_records")
      .upsert(records, { onConflict: "user_id,activity_id,service_date" });
    if (error) return { ...result, error: error.message };
    result.imported = records.length;

    // Refresh welfare flags if this is the attendance-signal activity.
    const { data: activity } = await admin
      .from("activities")
      .select("is_attendance_signal")
      .eq("id", activityId)
      .maybeSingle();
    if (activity?.is_attendance_signal) await recomputeMissedService(activityId);
  }

  revalidatePath("/secretary/attendance");
  revalidatePath("/welfare");
  return result;
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Imports a WIDE attendance register (names down the side, service dates across
 * the top — e.g. "WED 26/11", "SUN 30/11"). A present mark ("YES"/✓/P) = present,
 * blank = absent. Activity is inferred per column (SUN → Sunday Service, WED →
 * Bible Study), otherwise the chosen default activity. Month-only columns
 * (MARCH, APRIL…) and other non-date columns are ignored.
 */
export async function importWideAttendance(formData: FormData): Promise<AttendanceImportResult> {
  const empty: AttendanceImportResult = { imported: 0, skipped: [] };
  try {
    if (!(await isSecretary())) return { ...empty, error: "Secretary access required." };

    const file = formData.get("file") as File | null;
    const sheetUrl = String(formData.get("sheetUrl") ?? "").trim();
    const defaultActivityId = String(formData.get("activityId") ?? "");
    const year = parseInt(String(formData.get("year") ?? ""), 10) || new Date().getFullYear();
    if (!defaultActivityId) return { ...empty, error: "Pick a default activity." };

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

    const matrix = readBestRegisterMatrix(buffer);
    if (matrix.length < 2) return { ...empty, error: "That sheet looks empty." };
    const headers = matrix[0];
    const norm = (h: string) => h.trim().toLowerCase();

    const nameIdx = headers.findIndex((h) => /name/.test(norm(h)) && !/phone/.test(norm(h)));
    if (nameIdx < 0) return { ...empty, error: "Couldn't find a Name column in the register." };
    const phoneIdx = headers.findIndex((h) => /phone/.test(norm(h)));

    const admin = createAdminClient();
    const { data: acts } = await admin.from("activities").select("id, name");
    const findAct = (kw: string) => (acts ?? []).find((a) => a.name.toLowerCase().includes(kw))?.id;
    const sundayId = findAct("sunday");
    const bibleId = findAct("bible") || findAct("wednesday");

    // Detect dated service columns (header has a day/month like 30/11, or a date).
    const dateCols: { c: number; iso: string; act: string }[] = [];
    for (let c = 0; c < headers.length; c++) {
      if (c === nameIdx || c === phoneIdx) continue;
      const h = headers[c];
      let iso: string | null = null;
      const m = h.match(/(\d{1,2})\s*[/.\-]\s*(\d{1,2})/);
      if (m) {
        const d = +m[1], mo = +m[2];
        if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
          iso = `${year}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        }
      } else if (/\d/.test(h)) {
        const dt = new Date(h);
        if (!isNaN(dt.getTime())) iso = dt.toISOString().slice(0, 10);
      }
      if (!iso) continue;
      const act = /wed/i.test(h)
        ? bibleId || defaultActivityId
        : /sun/i.test(h)
        ? sundayId || defaultActivityId
        : defaultActivityId;
      dateCols.push({ c, iso, act });
    }

    // Detect month-tally columns (e.g. "FEB.", "MARCH") — a per-month count of
    // services attended, with no individual dates. Stored as a summary.
    const monthCols: { c: number; period: string }[] = [];
    for (let c = 0; c < headers.length; c++) {
      if (c === nameIdx || c === phoneIdx) continue;
      if (dateCols.some((dc) => dc.c === c)) continue;
      const mo = monthFromHeader(headers[c]);
      if (mo) monthCols.push({ c, period: `${year}-${String(mo).padStart(2, "0")}` });
    }

    if (dateCols.length === 0 && monthCols.length === 0) {
      return {
        ...empty,
        error: "No dated service columns (e.g. 'SUN 30/11') or month tallies (e.g. 'MARCH') found. Check the file/year.",
      };
    }

    const { data: profiles } = await admin.from("profiles").select("id, full_name, phone, whatsapp_number");
    const last10 = (p: string) => p.replace(/\D/g, "").slice(-10);
    const byPhone = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const p of profiles ?? []) {
      if (p.phone && last10(p.phone)) byPhone.set(last10(p.phone), p.id);
      if (p.whatsapp_number && last10(p.whatsapp_number)) byPhone.set(last10(p.whatsapp_number), p.id);
      byName.set(p.full_name.trim().toLowerCase(), p.id);
    }
    const presentMarks = ["yes", "y", "p", "present", "1", "true", "✓", "✔", "x"];

    const records: {
      user_id: string;
      activity_id: string;
      service_date: string;
      status: AttendanceStatus;
      source: "manual";
    }[] = [];
    const summaries: { user_id: string; period: string; count: number }[] = [];
    const result: AttendanceImportResult = { imported: 0, skipped: [] };

    for (let r = 1; r < matrix.length; r++) {
      const row = matrix[r];
      const name = String(row[nameIdx] ?? "").trim();
      if (!name) continue;
      const ph = phoneIdx >= 0 ? last10(String(row[phoneIdx] ?? "")) : "";
      const userId = (ph && byPhone.get(ph)) || byName.get(name.toLowerCase());
      if (!userId) {
        result.skipped.push({ row: r + 1, reason: `no member match: ${name}` });
        continue;
      }
      for (const dc of dateCols) {
        const cell = String(row[dc.c] ?? "").trim().toLowerCase();
        const status: AttendanceStatus = presentMarks.includes(cell) ? "present" : "absent";
        records.push({ user_id: userId, activity_id: dc.act, service_date: dc.iso, status, source: "manual" });
      }
      for (const mc of monthCols) {
        const raw = String(row[mc.c] ?? "").trim();
        if (raw === "") continue;
        const n = Number(raw.replace(/[^\d.]/g, ""));
        // A month tally is a small count. Larger values are corrupted (e.g. an
        // Excel date serial like 46086) — skip them rather than import garbage.
        if (!Number.isFinite(n) || n < 0 || n > 40) continue;
        summaries.push({ user_id: userId, period: mc.period, count: Math.round(n) });
      }
    }

    if (records.length) {
      // Upsert in chunks to stay within payload limits.
      for (let i = 0; i < records.length; i += 1000) {
        const { error } = await admin
          .from("attendance_records")
          .upsert(records.slice(i, i + 1000), { onConflict: "user_id,activity_id,service_date" });
        if (error) return { ...result, error: error.message };
      }
      result.imported = records.length;
      if (sundayId) await recomputeMissedService(sundayId);
    }

    if (summaries.length) {
      for (let i = 0; i < summaries.length; i += 1000) {
        const { error } = await admin
          .from("monthly_attendance_summary")
          .upsert(summaries.slice(i, i + 1000), { onConflict: "user_id,period" });
        if (error) return { ...result, error: error.message };
      }
      result.summaries = summaries.length;
    }

    revalidatePath("/secretary");
    revalidatePath("/welfare");
    return result;
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) };
  }
}
