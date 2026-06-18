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

/** Reads an uploaded .xlsx/.csv buffer into JSON rows, stripping empty rows. */
export function readSheetRows(buffer: Buffer): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  return rows.filter((r) =>
    Object.values(r).some((v) => String(v ?? "").trim() !== "")
  );
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

  const toolBlock = response.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("Parser did not return a tool result.");
  }
  return validateProposal(toolBlock.input);
}

/** Normalizes a free-text status to our enum (used for unmatched rows). */
export function normalizeStatus(raw: string): AttendanceStatus {
  const s = raw.trim().toLowerCase();
  if (["present", "p", "yes", "y", "✓", "x", "true", "1"].includes(s)) return "present";
  if (s.startsWith("trav")) return "traveled";
  if (s.startsWith("exc")) return "excused";
  return "absent";
}
