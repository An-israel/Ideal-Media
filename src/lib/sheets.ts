/**
 * Spreadsheet reading and proposal merging — the pure, testable half of
 * attendance ingestion. Deliberately free of `server-only` and of any API
 * client so it can be unit tested against real workbook fixtures; the bugs the
 * audit found here (single-sheet reads, duplicate-date batches, month/day
 * confusion) were all trivially testable and none of them were tested.
 */
import * as XLSX from "xlsx";
import type { AiProposal, AttendanceStatus } from "@/lib/database.types";

export interface RosterMember {
  id: string;
  full_name: string;
  primary_subunit: string | null;
}

/** Media types the vision API accepts for an attendance photo. */
export const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;
type ImageMediaType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export function isSupportedImageType(mediaType: string): mediaType is ImageMediaType {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(mediaType);
}

/**
 * Reads an uploaded .xlsx/.csv buffer into JSON rows, stripping empty rows.
 *
 * Reads EVERY sheet, not just the first (AUDIT ATT-1). This used to index
 * `wb.Sheets[wb.SheetNames[0]]`, so a workbook with a tab per month imported
 * one month and reported success. Rows carry `__sheet` so callers can tell the
 * operator which tab a problem row came from.
 *
 * Pass `{ raw: false }` to get cells as their displayed strings (handy for
 * dates), or the default `raw: true` to keep native numbers.
 */
export function readSheetRows(
  buffer: Buffer,
  opts?: { raw?: boolean }
): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const all: Record<string, unknown>[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: "",
      raw: opts?.raw ?? true,
    });
    for (const row of rows) {
      const hasContent = Object.values(row).some((v) => String(v ?? "").trim() !== "");
      if (hasContent) all.push({ ...row, __sheet: sheetName });
    }
  }
  return all;
}

/** Reads one named sheet as a raw matrix of strings (row 0 = headers). */
export function sheetToMatrix(ws: XLSX.WorkSheet): string[][] {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  return (aoa as unknown[][]).map((row) => row.map((c) => String(c ?? "")));
}

/**
 * Reads the first sheet as a raw matrix of strings (row 0 = headers). For wide
 * "register" layouts where dates run across the top.
 */
export function readSheetMatrix(buffer: Buffer): string[][] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  return sheetToMatrix(ws);
}

const MONTH_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
const DAYNUM_RE = /(\d{1,2})\s*[/.\-]\s*(\d{1,2})/;

export interface RegisterSheet {
  sheetName: string;
  /** Trimmed so row 0 is the header row. */
  matrix: string[][];
}

/**
 * Finds EVERY sheet in a workbook that looks like an attendance register — a
 * header row with a Name column plus at least one dated or month column —
 * trimmed so row 0 is that header.
 *
 * Returns all of them (AUDIT ATT-1). The previous `readBestRegisterMatrix`
 * scored every sheet but returned only the single highest-scoring one, so a
 * 12-tab yearly register imported one month.
 *
 * Handles real-world files with a blank leading row, a leading index column,
 * and the register on a sheet other than the first.
 */
export function readRegisterSheets(buffer: Buffer): RegisterSheet[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const found: RegisterSheet[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const aoa = sheetToMatrix(ws);

    // Pick the best header row within the first several rows of this sheet.
    let best: { matrix: string[][]; score: number } | null = null;
    for (let h = 0; h < Math.min(aoa.length, 8); h++) {
      const row = aoa[h];
      const hasName = row.some((c) => /name/i.test(c) && !/phone/i.test(c));
      if (!hasName) continue;
      const dated = row.filter(
        (c) => DAYNUM_RE.test(c) || (MONTH_RE.test(c) && !/name|phone|subunit/i.test(c))
      ).length;
      if (dated === 0) continue;
      if (!best || dated > best.score) best = { matrix: aoa.slice(h), score: dated };
    }

    if (best) found.push({ sheetName, matrix: best.matrix });
  }

  if (found.length > 0) return found;

  // No sheet looked like a register — fall back to the first sheet whole, so
  // the caller can still report a useful "no dated columns found" error.
  const firstName = wb.SheetNames[0];
  const firstWs = firstName ? wb.Sheets[firstName] : undefined;
  return firstWs ? [{ sheetName: firstName, matrix: sheetToMatrix(firstWs) }] : [];
}

/** Maps a header like "FEB.", "MARCH", "May" to a month number (1-12), or null. */
export function monthFromHeader(header: string): number | null {
  if (DAYNUM_RE.test(header)) return null; // dated column, not a month tally
  const m = header.match(MONTH_RE);
  if (!m) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  return months.indexOf(m[1].toLowerCase()) + 1;
}

/**
 * Merges per-chunk proposals into one (AUDIT ATT-3).
 *
 * Each chunk sees the whole sheet but only a slice of the roster, so:
 *   - matches            → union, keeping the highest-confidence match per member
 *   - roster_not_on_sheet → union (each chunk only reports its own slice)
 *   - unmatched_sheet_rows → a row is only truly unmatched if NO chunk matched it
 */
export function mergeProposals(parts: AiProposal[], roster: RosterMember[]): AiProposal {
  const validIds = new Set(roster.map((m) => m.id));

  const bestByMember = new Map<string, AiProposal["matches"][number]>();
  for (const part of parts) {
    for (const m of part.matches) {
      // Guard against a hallucinated id slipping through into a DB write.
      if (!validIds.has(m.roster_id)) continue;
      const existing = bestByMember.get(m.roster_id);
      if (!existing || (m.confidence ?? 0) > (existing.confidence ?? 0)) {
        bestByMember.set(m.roster_id, m);
      }
    }
  }
  const matches = [...bestByMember.values()];

  const matchedNames = new Set(matches.map((m) => m.name_on_sheet.trim().toLowerCase()));
  const unmatchedByName = new Map<string, AiProposal["unmatched_sheet_rows"][number]>();
  for (const part of parts) {
    for (const row of part.unmatched_sheet_rows) {
      const key = row.name_on_sheet.trim().toLowerCase();
      if (!key || matchedNames.has(key)) continue;
      if (!unmatchedByName.has(key)) unmatchedByName.set(key, row);
    }
  }

  const notOnSheet = new Map<string, AiProposal["roster_not_on_sheet"][number]>();
  for (const part of parts) {
    for (const r of part.roster_not_on_sheet) {
      if (!validIds.has(r.roster_id)) continue;
      if (bestByMember.has(r.roster_id)) continue; // matched in another chunk
      notOnSheet.set(r.roster_id, r);
    }
  }

  return {
    matches,
    unmatched_sheet_rows: [...unmatchedByName.values()],
    roster_not_on_sheet: [...notOnSheet.values()],
  };
}

/** Normalizes a free-text status to our enum (used for unmatched rows). */
export function normalizeStatus(raw: string): AttendanceStatus {
  const s = raw.trim().toLowerCase();
  if (["present", "p", "yes", "y", "✓", "✔", "x", "true", "1"].includes(s)) return "present";
  if (s.startsWith("trav")) return "traveled";
  if (s.startsWith("exc")) return "excused";
  return "absent";
}

/** One attendance record as written to the database. */
export interface AttendanceRow {
  user_id: string;
  activity_id: string;
  service_date: string;
  status: AttendanceStatus;
  source: "manual";
}

/**
 * Collapses records to one per (member, activity, date).
 *
 * Registers routinely repeat or merge a date header. Two rows with the same
 * conflict key in one upsert batch make Postgres reject the WHOLE batch with
 * "ON CONFLICT DO UPDATE command cannot affect row a second time", so a single
 * duplicated column failed the entire import with a raw Postgres error
 * (AUDIT ATT-5).
 *
 * `present` wins over `absent` for the same slot — a tick somewhere in the
 * register is positive evidence the person attended.
 */
export function dedupeAttendanceRows(records: AttendanceRow[]): AttendanceRow[] {
  const byKey = new Map<string, AttendanceRow>();
  for (const r of records) {
    const key = `${r.user_id}|${r.activity_id}|${r.service_date}`;
    const existing = byKey.get(key);
    if (!existing || (existing.status === "absent" && r.status !== "absent")) {
      byKey.set(key, r);
    }
  }
  return [...byKey.values()];
}
