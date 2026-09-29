"use server";

import { revalidatePath } from "next/cache";
import { getSessionRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  readSheetRows,
  readRegisterSheets,
  monthFromHeader,
  normalizeStatus,
  dedupeAttendanceRows,
  type AttendanceRow,
} from "@/lib/sheets";
import { fetchSheetAsBuffer } from "@/lib/google-sheets";
import { mapAttendanceColumns, type AttendanceColumnMap } from "@/lib/import-mapper";
import { recomputeMissedService } from "@/lib/welfare-automation";
import { fetchAllRows, chunk } from "@/lib/pagination";
import { coerceISODate } from "@/lib/dates";
import { phoneKey } from "@/lib/phone";
import { ACCEPTED_UPLOAD_EXT, MAX_UPLOAD_BYTES, PAGE_SIZE } from "@/lib/constants";


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
function pick(
  lookup: Record<string, unknown>,
  mappedHeader: string | undefined,
  heuristics: string[]
): unknown {
  if (mappedHeader) {
    const v = lookup[mappedHeader.trim().toLowerCase()];
    if (v != null && String(v).trim() !== "") return v;
  }
  return field(lookup, heuristics);
}

/** Reads the whole profiles table (paged) and builds lookup maps. */
async function buildMemberIndex(admin: ReturnType<typeof createAdminClient>) {
  type Row = {
    id: string;
    email: string | null;
    full_name: string;
    phone: string | null;
    whatsapp_number: string | null;
  };

  // Paged — an unbounded select caps at 1000 rows with no error, so members
  // past the first page simply never matched (AUDIT PERF-2 / ROS-3).
  const profiles = await fetchAllRows<Row>((from, to) =>
    admin
      .from("profiles")
      .select("id, email, full_name, phone, whatsapp_number")
      .order("created_at", { ascending: true })
      .range(from, to)
  );

  const byEmail = new Map<string, string>();
  const byName = new Map<string, string>();
  const byPhone = new Map<string, string>();
  for (const p of profiles) {
    if (p.email) byEmail.set(p.email.toLowerCase(), p.id);
    byName.set(p.full_name.trim().toLowerCase(), p.id);
    for (const raw of [p.phone, p.whatsapp_number]) {
      const key = phoneKey(raw);
      if (key) byPhone.set(key, p.id);
    }
  }
  return { byEmail, byName, byPhone, count: profiles.length };
}

/** Upserts attendance in chunks, returning an error message on failure. */
async function upsertAttendance(
  admin: ReturnType<typeof createAdminClient>,
  records: AttendanceRow[]
): Promise<string | null> {
  for (const batch of chunk(records, PAGE_SIZE)) {
    const { error } = await admin
      .from("attendance_records")
      .upsert(batch, { onConflict: "user_id,activity_id,service_date" });
    if (error) return error.message;
  }
  return null;
}

export interface AttendanceImportResult {
  imported: number;
  skipped: { row: number; reason: string }[];
  /** Number of monthly tallies imported (e.g. "5 in March"). */
  summaries?: number;
  /** Workbook tabs that were read. */
  sheets?: string[];
  /** Partial-success note (e.g. tallies skipped) — import still worked. */
  warning?: string;
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
    // Historical imports don't open present-day welfare follow-ups unless asked
    // (AUDIT ATT-4). Importing an old register used to flag members for missing
    // services that happened before they joined the team.
    const runWelfare = String(formData.get("runWelfare") ?? "") === "on";
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
    // Reads every sheet in the workbook, not just the first (AUDIT ATT-1).
    const rows = readSheetRows(buffer);
    if (rows.length === 0) {
      return { ...empty, error: "That sheet looks empty — check the link/file." };
    }

    const { byEmail, byName } = await buildMemberIndex(admin);

    // Let AI map the columns (the sheet's headers may be messy/unexpected).
    const headers = Object.keys(rows[0]).filter((h) => h !== "__sheet");
    let colMap: AttendanceColumnMap | null = null;
    try {
      colMap = await mapAttendanceColumns(headers, rows.slice(0, 5));
    } catch (e) {
      console.error("[import-attendance] column mapping failed:", e);
      colMap = null;
    }

    const result: AttendanceImportResult = { imported: 0, skipped: [] };
    const records: AttendanceRow[] = [];

    for (let i = 0; i < rows.length; i++) {
      const lookup: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rows[i])) lookup[k.trim().toLowerCase()] = v;
      const sheetName = String(rows[i].__sheet ?? "");
      const rowLabel = sheetName ? `${sheetName}!${i + 2}` : String(i + 2);

      const email = String(pick(lookup, colMap?.email, ["email", "email address"]))
        .toLowerCase()
        .trim();
      const memberName = String(pick(lookup, colMap?.name, ["name", "full name", "member"])).trim();
      const userId =
        (email && byEmail.get(email)) || (memberName && byName.get(memberName.toLowerCase()));
      if (!userId) {
        result.skipped.push({
          row: i + 2,
          reason: `row ${rowLabel}: no member match (${email || memberName || "blank"})`,
        });
        continue;
      }

      // Calendar-day coercion, day-first, with no UTC round-trip (AUDIT ATT-6).
      const date = coerceISODate(pick(lookup, colMap?.date, ["date", "service date", "day"]));
      if (!date) {
        result.skipped.push({ row: i + 2, reason: `row ${rowLabel}: unreadable date` });
        continue;
      }

      const status = normalizeStatus(
        String(pick(lookup, colMap?.status, ["status", "attendance", "present"]))
      );
      records.push({
        user_id: userId,
        activity_id: activityId,
        service_date: date,
        status,
        source: "manual",
      });
    }

    // Nothing usable + mostly unreadable dates → almost certainly a register
    // layout (dates across the top), not one-row-per-record. Say so instead of
    // reporting a successful import of zero records.
    if (records.length === 0 && result.skipped.length > 0) {
      const dateFails = result.skipped.filter((s) => s.reason.endsWith("unreadable date")).length;
      if (dateFails >= result.skipped.length / 2) {
        return {
          ...result,
          error:
            "This file doesn't look like one-row-per-record — most rows had no readable date. " +
            "If names run down the side with dates across the top (like the media list), switch the " +
            "Sheet layout above to \u201cRegister (dates across the top)\u201d and import again.",
        };
      }
    }

    const deduped = dedupeAttendanceRows(records);
    if (deduped.length) {
      const err = await upsertAttendance(admin, deduped);
      if (err) return { ...result, error: err };
      result.imported = deduped.length;

      if (runWelfare) {
        const { data: activity } = await admin
          .from("activities")
          .select("is_attendance_signal")
          .eq("id", activityId)
          .maybeSingle();
        if (activity?.is_attendance_signal) await recomputeMissedService(activityId);
      }
    }

    result.sheets = [...new Set(rows.map((r) => String(r.__sheet ?? "")).filter(Boolean))];

    revalidatePath("/secretary/attendance");
    revalidatePath("/secretary");
    revalidatePath("/welfare");
    revalidatePath("/dashboard");
    return result;
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Imports a WIDE attendance register (names down the side, service dates across
 * the top — e.g. "WED 26/11", "SUN 30/11"). A present mark ("YES"/✓/P) = present,
 * blank = absent (or skipped — see `blankPolicy`). Activity is inferred per
 * column (SUN → Sunday Service, WED → Bible Study), otherwise the chosen default
 * activity. Month-only columns (MARCH, APRIL…) are stored as monthly tallies.
 *
 * Reads EVERY register sheet in the workbook (AUDIT ATT-1) — the previous
 * version scored all sheets but imported only the single best one, so a
 * 12-tab yearly register imported one month and reported success.
 */
export async function importWideAttendance(formData: FormData): Promise<AttendanceImportResult> {
  const empty: AttendanceImportResult = { imported: 0, skipped: [] };
  try {
    if (!(await isSecretary())) return { ...empty, error: "Secretary access required." };

    const file = formData.get("file") as File | null;
    const sheetUrl = String(formData.get("sheetUrl") ?? "").trim();
    const defaultActivityId = String(formData.get("activityId") ?? "");
    const year = parseInt(String(formData.get("year") ?? ""), 10) || new Date().getFullYear();
    // "skip" leaves blanks unrecorded instead of asserting an absence, for
    // registers that only mark attendance (AUDIT ATT-4).
    const blankPolicy = String(formData.get("blankPolicy") ?? "absent") === "skip" ? "skip" : "absent";
    const runWelfare = String(formData.get("runWelfare") ?? "") === "on";
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

    const registerSheets = readRegisterSheets(buffer);
    if (registerSheets.length === 0) return { ...empty, error: "That workbook looks empty." };

    const admin = createAdminClient();
    const { data: acts } = await admin.from("activities").select("id, name");
    const findAct = (kw: string) =>
      (acts ?? []).find((a) => a.name.toLowerCase().includes(kw))?.id;
    const sundayId = findAct("sunday");
    const bibleId = findAct("bible") || findAct("wednesday");

    const { byName, byPhone } = await buildMemberIndex(admin);
    const presentMarks = ["yes", "y", "p", "present", "1", "true", "✓", "✔", "x"];

    const records: AttendanceRow[] = [];
    const summaries = new Map<string, { user_id: string; period: string; count: number }>();
    const result: AttendanceImportResult = { imported: 0, skipped: [], sheets: [] };
    const activityIdsTouched = new Set<string>();

    for (const { sheetName, matrix } of registerSheets) {
      if (matrix.length < 2) continue;
      const headers = matrix[0];
      const norm = (h: string) => h.trim().toLowerCase();

      const nameIdx = headers.findIndex((h) => /name/.test(norm(h)) && !/phone/.test(norm(h)));
      if (nameIdx < 0) {
        result.skipped.push({ row: 0, reason: `sheet "${sheetName}": no Name column — skipped` });
        continue;
      }
      const phoneIdx = headers.findIndex((h) => /phone/.test(norm(h)));

      // Detect dated service columns (header has a day/month like 30/11).
      const dateCols: { c: number; iso: string; act: string }[] = [];
      for (let c = 0; c < headers.length; c++) {
        if (c === nameIdx || c === phoneIdx) continue;
        const h = headers[c];
        // Day-first, anchored to the chosen year, no UTC round-trip (ATT-6).
        const iso = coerceISODate(h, { dayFirst: true, year });
        if (!iso) continue;
        const act = /wed/i.test(h)
          ? bibleId || defaultActivityId
          : /sun/i.test(h)
          ? sundayId || defaultActivityId
          : defaultActivityId;
        dateCols.push({ c, iso, act });
        activityIdsTouched.add(act);
      }

      // Detect month-tally columns (e.g. "FEB.", "MARCH") — a per-month count
      // of services attended, with no individual dates.
      const monthCols: { c: number; period: string }[] = [];
      for (let c = 0; c < headers.length; c++) {
        if (c === nameIdx || c === phoneIdx) continue;
        if (dateCols.some((dc) => dc.c === c)) continue;
        const mo = monthFromHeader(headers[c]);
        if (mo) monthCols.push({ c, period: `${year}-${String(mo).padStart(2, "0")}` });
      }

      if (dateCols.length === 0 && monthCols.length === 0) {
        result.skipped.push({
          row: 0,
          reason: `sheet "${sheetName}": no dated columns (e.g. 'SUN 30/11') or month tallies — skipped`,
        });
        continue;
      }

      result.sheets!.push(sheetName);

      for (let r = 1; r < matrix.length; r++) {
        const row = matrix[r];
        const name = String(row[nameIdx] ?? "").trim();
        if (!name) continue;
        const ph = phoneIdx >= 0 ? phoneKey(String(row[phoneIdx] ?? "")) : null;
        const userId = (ph && byPhone.get(ph)) || byName.get(name.toLowerCase());
        if (!userId) {
          result.skipped.push({
            row: r + 1,
            reason: `sheet "${sheetName}" row ${r + 1}: no member match: ${name}`,
          });
          continue;
        }

        for (const dc of dateCols) {
          const cell = String(row[dc.c] ?? "").trim().toLowerCase();
          const isPresent = presentMarks.includes(cell);
          if (!isPresent && blankPolicy === "skip") continue;
          records.push({
            user_id: userId,
            activity_id: dc.act,
            service_date: dc.iso,
            status: isPresent ? "present" : "absent",
            source: "manual",
          });
        }

        for (const mc of monthCols) {
          const raw = String(row[mc.c] ?? "").trim();
          if (raw === "") continue;
          const n = Number(raw.replace(/[^\d.]/g, ""));
          // A month tally is a small count. Larger values are corrupted (e.g.
          // an Excel date serial like 46086) — skip rather than import garbage.
          if (!Number.isFinite(n) || n < 0 || n > 40) continue;
          // Keyed so a month repeated across sheets can't break the upsert.
          const key = `${userId}|${mc.period}`;
          const existing = summaries.get(key);
          const count = Math.round(n);
          if (!existing || count > existing.count) {
            summaries.set(key, { user_id: userId, period: mc.period, count });
          }
        }
      }
    }

    if (result.sheets!.length === 0) {
      return {
        ...result,
        error:
          "No sheet had dated service columns (e.g. 'SUN 30/11') or month tallies (e.g. 'MARCH'). Check the file and the year.",
      };
    }

    const deduped = dedupeAttendanceRows(records);
    if (deduped.length) {
      const err = await upsertAttendance(admin, deduped);
      if (err) return { ...result, error: err };
      result.imported = deduped.length;
    }

    if (summaries.size) {
      let summaryErr: string | null = null;
      for (const batch of chunk([...summaries.values()], PAGE_SIZE)) {
        const { error } = await admin
          .from("monthly_attendance_summary")
          .upsert(batch, { onConflict: "user_id,period" });
        if (error) {
          summaryErr = error.message;
          break;
        }
      }
      if (summaryErr) {
        // The dated records are already in. Don't throw that away because the
        // tally table is missing (setup SQL not run yet) — warn instead.
        result.warning =
          `Attendance records imported, but the monthly tallies (FEB/MARCH/\u2026) could not be saved: ` +
          `${summaryErr}. Run the latest migrations in Supabase, then re-import \u2014 it's safe to repeat.`;
      } else {
        result.summaries = summaries.size;
      }
    }

    // Recompute welfare flags for every signal activity actually touched — not
    // just Sunday (AUDIT ATT-4/WEL-2) — and only when asked, so a historical
    // import doesn't manufacture present-day follow-ups.
    if (runWelfare && deduped.length) {
      const signalIds = new Set(
        (acts ?? [])
          .filter((a) => activityIdsTouched.has(a.id))
          .map((a) => a.id)
      );
      const { data: signals } = await admin
        .from("activities")
        .select("id")
        .eq("is_attendance_signal", true);
      for (const s of signals ?? []) {
        if (signalIds.has(s.id)) await recomputeMissedService(s.id);
      }
    }

    revalidatePath("/secretary");
    revalidatePath("/secretary/attendance");
    revalidatePath("/welfare");
    revalidatePath("/dashboard");
    return result;
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) };
  }
}
