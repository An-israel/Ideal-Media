import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";
import { ATTENDANCE_PARSE_MODEL } from "@/lib/constants";
import type { AiProposal, AttendanceStatus } from "@/lib/database.types";

export interface RosterMember {
  id: string;
  full_name: string;
  primary_subunit: string | null;
}

/** Reads an uploaded .xlsx/.csv buffer into JSON rows, stripping empty rows.
 * Pass `{ raw: false }` to get cells as their displayed strings (handy for
 * dates), or the default `raw: true` to keep native numbers. */
export function readSheetRows(
  buffer: Buffer,
  opts?: { raw?: boolean }
): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: "",
    raw: opts?.raw ?? true,
  });
  return rows.filter((r) =>
    Object.values(r).some((v) => String(v ?? "").trim() !== "")
  );
}

/** Reads a sheet as a raw matrix of strings (row 0 = headers). For wide
 * "register" layouts where dates run across the top. */
export function readSheetMatrix(buffer: Buffer): string[][] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  return (aoa as unknown[][]).map((row) => row.map((c) => String(c ?? "")));
}

// Single tool whose input_schema is the exact JSON shape we want back. Forcing
// this tool (tool_choice) gives strict, parseable JSON instead of prose.
const PROPOSAL_TOOL: Anthropic.Tool = {
  name: "report_attendance_mapping",
  description:
    "Report the mapping of each attendance sheet row to a roster member, plus any rows that could not be matched and roster members absent from the sheet.",
  input_schema: {
    type: "object",
    properties: {
      matches: {
        type: "array",
        items: {
          type: "object",
          properties: {
            roster_id: { type: "string", description: "The roster member's id (uuid)." },
            name_on_sheet: { type: "string" },
            status: { type: "string", enum: ["present", "absent", "traveled", "excused"] },
            confidence: { type: "number", description: "0.0 to 1.0 match confidence." },
          },
          required: ["roster_id", "name_on_sheet", "status", "confidence"],
        },
      },
      unmatched_sheet_rows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name_on_sheet: { type: "string" },
            raw: { type: "string" },
            status: { type: "string" },
          },
          required: ["name_on_sheet", "raw", "status"],
        },
      },
      roster_not_on_sheet: {
        type: "array",
        items: {
          type: "object",
          properties: {
            roster_id: { type: "string" },
            full_name: { type: "string" },
          },
          required: ["roster_id", "full_name"],
        },
      },
    },
    required: ["matches", "unmatched_sheet_rows", "roster_not_on_sheet"],
  },
};

function rosterPrompt(roster: RosterMember[]): string {
  return (
    "ROSTER (match against these — use the exact `id` for roster_id):\n" +
    JSON.stringify(roster, null, 2)
  );
}

function extractProposal(response: Anthropic.Message): AiProposal {
  const toolBlock = response.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("Parser did not return a tool result.");
  }
  return validateProposal(toolBlock.input);
}

function validateProposal(input: unknown): AiProposal {
  const p = input as Partial<AiProposal> | null;
  if (
    !p ||
    !Array.isArray(p.matches) ||
    !Array.isArray(p.unmatched_sheet_rows) ||
    !Array.isArray(p.roster_not_on_sheet)
  ) {
    throw new Error("Parser returned an unexpected shape.");
  }
  return p as AiProposal;
}

/**
 * Calls Claude (server-side) to map sheet rows to the roster (Section 12).
 * Uses forced tool use for strict JSON. Model is pinned in constants.
 */
export async function parseAttendance(
  rows: Record<string, unknown>[],
  roster: RosterMember[]
): Promise<AiProposal> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const prompt =
    "You are mapping a church media team's weekly attendance sheet to the member roster.\n\n" +
    "ROSTER (match against these — use the exact `id` for roster_id):\n" +
    JSON.stringify(roster, null, 2) +
    "\n\nSHEET ROWS (each row represents one person's attendance):\n" +
    JSON.stringify(rows, null, 2) +
    "\n\nInstructions: Match each sheet row to exactly one roster member by name, " +
    "tolerating nicknames, reordered first/last names, casing, and minor misspellings. " +
    "Determine each person's status (present/absent/traveled/excused) from the row " +
    "(treat ticks/present/P/yes as present; blanks/absent/A as absent). Do not invent members. " +
    "Put rows you cannot confidently match in unmatched_sheet_rows, and roster members with no " +
    "corresponding row in roster_not_on_sheet. Report your result via the tool.";

  const response = await client.messages.create({
    model: ATTENDANCE_PARSE_MODEL,
    max_tokens: 8000,
    tools: [PROPOSAL_TOOL],
    tool_choice: { type: "tool", name: PROPOSAL_TOOL.name },
    messages: [{ role: "user", content: prompt }],
  });

  return extractProposal(response);
}

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/**
 * Reads attendance from a PHOTO of a sheet/register (Claude vision) and maps it
 * to the roster — same strict tool-use JSON as the spreadsheet path. Lets the
 * secretary snap a picture instead of typing up a spreadsheet (Section 12).
 */
export async function parseAttendanceImage(
  base64: string,
  mediaType: string,
  roster: RosterMember[]
): Promise<AiProposal> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const media = (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mediaType)
    ? mediaType
    : "image/jpeg") as ImageMediaType;

  const prompt =
    "The image is a photo of a church media team's attendance sheet or register " +
    "(it may be printed or handwritten).\n\n" +
    rosterPrompt(roster) +
    "\n\nRead every person listed in the photo and match each to exactly one roster " +
    "member by name, tolerating nicknames, reordered first/last names, casing, and " +
    "minor misspellings. Determine each person's status from the row (a tick/check/" +
    "'P'/'present'/highlight means present; blank, dash, 'A', or crossed-out means " +
    "absent; note 'traveled'/'excused' if written). Do not invent members. Put names " +
    "you cannot confidently match in unmatched_sheet_rows, and roster members with no " +
    "row in roster_not_on_sheet. Report your result via the tool.";

  const response = await client.messages.create({
    model: ATTENDANCE_PARSE_MODEL,
    max_tokens: 8000,
    tools: [PROPOSAL_TOOL],
    tool_choice: { type: "tool", name: PROPOSAL_TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: media, data: base64 } },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  return extractProposal(response);
}

/** Normalizes a free-text status to our enum (used for unmatched rows). */
export function normalizeStatus(raw: string): AttendanceStatus {
  const s = raw.trim().toLowerCase();
  if (["present", "p", "yes", "y", "✓", "x", "true", "1"].includes(s)) return "present";
  if (s.startsWith("trav")) return "traveled";
  if (s.startsWith("exc")) return "excused";
  return "absent";
}
