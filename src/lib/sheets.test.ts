import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  readSheetRows,
  readRegisterSheets,
  monthFromHeader,
  normalizeStatus,
  dedupeAttendanceRows,
  mergeProposals,
  isSupportedImageType,
  type AttendanceRow,
  type RosterMember,
} from "./sheets";
import type { AiProposal } from "@/lib/database.types";

/** Builds an .xlsx buffer from named sheets of array-of-arrays data. */
function workbook(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("readSheetRows", () => {
  it("reads EVERY sheet, not just the first", () => {
    // The original indexed wb.Sheets[wb.SheetNames[0]], so a workbook with a
    // tab per month imported one month and reported success (ATT-1).
    const buf = workbook({
      January: [
        ["Name", "Status"],
        ["Ada", "YES"],
      ],
      February: [
        ["Name", "Status"],
        ["Bola", "YES"],
        ["Chidi", ""],
      ],
    });

    const rows = readSheetRows(buf);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.Name)).toEqual(["Ada", "Bola", "Chidi"]);
  });

  it("tags each row with the sheet it came from", () => {
    const buf = workbook({
      March: [["Name"], ["Ada"]],
      April: [["Name"], ["Bola"]],
    });
    const rows = readSheetRows(buf);
    expect(rows.find((r) => r.Name === "Ada")?.__sheet).toBe("March");
    expect(rows.find((r) => r.Name === "Bola")?.__sheet).toBe("April");
  });

  it("drops fully empty rows", () => {
    const buf = workbook({
      Sheet1: [["Name", "Status"], ["Ada", "YES"], ["", ""], ["Bola", "YES"]],
    });
    expect(readSheetRows(buf)).toHaveLength(2);
  });

  it("returns an empty array for an empty workbook sheet", () => {
    expect(readSheetRows(workbook({ Sheet1: [] }))).toEqual([]);
  });
});

describe("readRegisterSheets", () => {
  it("returns EVERY register sheet, not just the best-scoring one", () => {
    // readBestRegisterMatrix scored all sheets but returned only the winner,
    // so a 12-tab yearly register imported one month (ATT-1).
    const buf = workbook({
      Nov: [
        ["Name", "Phone", "SUN 02/11", "SUN 09/11"],
        ["Ada", "08031234567", "YES", ""],
      ],
      Dec: [
        ["Name", "Phone", "SUN 07/12", "SUN 14/12", "SUN 21/12"],
        ["Ada", "08031234567", "YES", "YES", ""],
      ],
    });

    const sheets = readRegisterSheets(buf);
    expect(sheets.map((s) => s.sheetName).sort()).toEqual(["Dec", "Nov"]);
  });

  it("trims leading junk rows so row 0 is the header", () => {
    const buf = workbook({
      Register: [
        ["MEDIA DEPARTMENT ATTENDANCE"],
        [],
        ["S/N", "Name", "SUN 30/11"],
        [1, "Ada", "YES"],
      ],
    });
    const [sheet] = readRegisterSheets(buf);
    expect(sheet.matrix[0]).toContain("Name");
    expect(sheet.matrix[0]).toContain("SUN 30/11");
    expect(sheet.matrix[1]).toContain("Ada");
  });

  it("ignores sheets with no dated columns", () => {
    const buf = workbook({
      Notes: [["Name", "Comment"], ["Ada", "on leave"]],
      Register: [["Name", "SUN 30/11"], ["Ada", "YES"]],
    });
    const sheets = readRegisterSheets(buf);
    expect(sheets.map((s) => s.sheetName)).toEqual(["Register"]);
  });

  it("falls back to the first sheet when nothing looks like a register", () => {
    const buf = workbook({ Only: [["Foo", "Bar"], ["a", "b"]] });
    const sheets = readRegisterSheets(buf);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].sheetName).toBe("Only");
  });
});

describe("monthFromHeader", () => {
  it("maps month names and abbreviations", () => {
    expect(monthFromHeader("MARCH")).toBe(3);
    expect(monthFromHeader("FEB.")).toBe(2);
    expect(monthFromHeader("Dec")).toBe(12);
  });

  it("returns null for a dated column rather than treating it as a tally", () => {
    expect(monthFromHeader("SUN 30/11")).toBeNull();
  });

  it("returns null for non-month headers", () => {
    expect(monthFromHeader("Name")).toBeNull();
    expect(monthFromHeader("Phone")).toBeNull();
    expect(monthFromHeader("")).toBeNull();
  });
});

describe("normalizeStatus", () => {
  it("reads the many ways a register marks present", () => {
    for (const mark of ["present", "P", "yes", "Y", "✓", "✔", "x", "1", "true"]) {
      expect(normalizeStatus(mark)).toBe("present");
    }
  });

  it("reads traveled and excused", () => {
    expect(normalizeStatus("traveled")).toBe("traveled");
    expect(normalizeStatus("Travelled")).toBe("traveled");
    expect(normalizeStatus("excused")).toBe("excused");
  });

  it("treats anything else as absent", () => {
    expect(normalizeStatus("")).toBe("absent");
    expect(normalizeStatus("A")).toBe("absent");
    expect(normalizeStatus("-")).toBe("absent");
  });
});

describe("dedupeAttendanceRows", () => {
  const row = (over: Partial<AttendanceRow> = {}): AttendanceRow => ({
    user_id: "u1",
    activity_id: "a1",
    service_date: "2025-03-09",
    status: "absent",
    source: "manual",
    ...over,
  });

  it("collapses duplicate (member, activity, date) keys", () => {
    // Two rows with the same conflict key made Postgres reject the WHOLE upsert
    // batch — one repeated date header failed the entire import (ATT-5).
    const out = dedupeAttendanceRows([row(), row()]);
    expect(out).toHaveLength(1);
  });

  it("prefers present over absent for the same slot", () => {
    const out = dedupeAttendanceRows([row({ status: "absent" }), row({ status: "present" })]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("present");
  });

  it("keeps present when it comes first", () => {
    const out = dedupeAttendanceRows([row({ status: "present" }), row({ status: "absent" })]);
    expect(out[0].status).toBe("present");
  });

  it("keeps genuinely distinct rows", () => {
    const out = dedupeAttendanceRows([
      row(),
      row({ service_date: "2025-03-16" }),
      row({ activity_id: "a2" }),
      row({ user_id: "u2" }),
    ]);
    expect(out).toHaveLength(4);
  });

  it("handles an empty input", () => {
    expect(dedupeAttendanceRows([])).toEqual([]);
  });
});

describe("mergeProposals", () => {
  const roster: RosterMember[] = [
    { id: "u1", full_name: "Ada", primary_subunit: "Photography" },
    { id: "u2", full_name: "Bola", primary_subunit: "Projection" },
  ];

  const proposal = (over: Partial<AiProposal> = {}): AiProposal => ({
    matches: [],
    unmatched_sheet_rows: [],
    roster_not_on_sheet: [],
    ...over,
  });

  it("unions matches across roster chunks", () => {
    const merged = mergeProposals(
      [
        proposal({
          matches: [{ roster_id: "u1", name_on_sheet: "Ada", status: "present", confidence: 0.9 }],
          roster_not_on_sheet: [],
        }),
        proposal({
          matches: [{ roster_id: "u2", name_on_sheet: "Bola", status: "absent", confidence: 0.8 }],
        }),
      ],
      roster
    );
    expect(merged.matches.map((m) => m.roster_id).sort()).toEqual(["u1", "u2"]);
  });

  it("keeps the highest-confidence match per member", () => {
    const merged = mergeProposals(
      [
        proposal({
          matches: [{ roster_id: "u1", name_on_sheet: "A. Okeke", status: "absent", confidence: 0.4 }],
        }),
        proposal({
          matches: [{ roster_id: "u1", name_on_sheet: "Ada", status: "present", confidence: 0.95 }],
        }),
      ],
      roster
    );
    expect(merged.matches).toHaveLength(1);
    expect(merged.matches[0].name_on_sheet).toBe("Ada");
    expect(merged.matches[0].status).toBe("present");
  });

  it("drops a roster_id that isn't on the roster", () => {
    const merged = mergeProposals(
      [
        proposal({
          matches: [
            { roster_id: "ghost", name_on_sheet: "Nobody", status: "present", confidence: 1 },
          ],
        }),
      ],
      roster
    );
    expect(merged.matches).toEqual([]);
  });

  it("only reports a sheet row unmatched when NO chunk matched it", () => {
    const merged = mergeProposals(
      [
        // Chunk 1 didn't have Bola in its roster slice, so it reported her row
        // as unmatched.
        proposal({
          unmatched_sheet_rows: [{ name_on_sheet: "Bola", raw: "{}", status: "present" }],
        }),
        // Chunk 2 did have her and matched it.
        proposal({
          matches: [{ roster_id: "u2", name_on_sheet: "Bola", status: "present", confidence: 0.9 }],
        }),
      ],
      roster
    );
    expect(merged.unmatched_sheet_rows).toEqual([]);
    expect(merged.matches).toHaveLength(1);
  });

  it("keeps a row that no chunk could match", () => {
    const merged = mergeProposals(
      [
        proposal({
          unmatched_sheet_rows: [{ name_on_sheet: "Unknown Person", raw: "{}", status: "" }],
        }),
      ],
      roster
    );
    expect(merged.unmatched_sheet_rows).toHaveLength(1);
  });

  it("drops roster_not_on_sheet entries matched by another chunk", () => {
    const merged = mergeProposals(
      [
        proposal({ roster_not_on_sheet: [{ roster_id: "u1", full_name: "Ada" }] }),
        proposal({
          matches: [{ roster_id: "u1", name_on_sheet: "Ada", status: "present", confidence: 0.9 }],
        }),
      ],
      roster
    );
    expect(merged.roster_not_on_sheet).toEqual([]);
  });

  it("keeps a member genuinely absent from the sheet", () => {
    const merged = mergeProposals(
      [proposal({ roster_not_on_sheet: [{ roster_id: "u2", full_name: "Bola" }] })],
      roster
    );
    expect(merged.roster_not_on_sheet).toHaveLength(1);
    expect(merged.roster_not_on_sheet[0].roster_id).toBe("u2");
  });
});

describe("isSupportedImageType", () => {
  it("accepts the types the vision API takes", () => {
    expect(isSupportedImageType("image/jpeg")).toBe(true);
    expect(isSupportedImageType("image/png")).toBe(true);
  });

  it("rejects anything else rather than relabelling it as JPEG", () => {
    // An unrecognised type used to be silently declared as image/jpeg, so a
    // HEIC from an iPhone failed server-side with a confusing error (ATT-9).
    expect(isSupportedImageType("image/heic")).toBe(false);
    expect(isSupportedImageType("application/pdf")).toBe(false);
    expect(isSupportedImageType("")).toBe(false);
  });
});
