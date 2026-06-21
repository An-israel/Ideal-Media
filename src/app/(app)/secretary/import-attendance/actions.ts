"use server";

import { revalidatePath } from "next/cache";
import { getSessionRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSheetRows, normalizeStatus } from "@/lib/attendance-parser";
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
