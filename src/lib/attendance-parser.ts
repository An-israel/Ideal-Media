import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  ATTENDANCE_PARSE_MODEL,
  ATTENDANCE_VISION_MODEL,
  PARSE_ROSTER_CHUNK,
  PARSE_MAX_TOKENS,
} from "@/lib/constants";
import { chunk } from "@/lib/pagination";
import { mergeProposals, type RosterMember } from "@/lib/sheets";
import type { AiProposal } from "@/lib/database.types";

// The pure spreadsheet half lives in lib/sheets.ts (no server-only, no API
// client) so it can be unit tested against real workbook fixtures. Re-exported
// here so existing imports keep working.
export {
  readSheetRows,
  readRegisterSheets,
  monthFromHeader,
  normalizeStatus,
  dedupeAttendanceRows,
  isSupportedImageType,
  SUPPORTED_IMAGE_TYPES,
  type RegisterSheet,
  type RosterMember,
  type AttendanceRow,
} from "@/lib/sheets";

type ImageMediaType = (typeof import("@/lib/sheets").SUPPORTED_IMAGE_TYPES)[number];

// Single tool whose input_schema is the exact JSON shape we want back. Forcing
// this tool (tool_choice) gives strict, parseable JSON instead of prose, and
// `strict: true` guarantees the input validates against the schema.
const PROPOSAL_TOOL: Anthropic.Tool = {
  name: "report_attendance_mapping",
  description:
    "Report the mapping of each attendance sheet row to a roster member, plus any rows that could not be matched and roster members absent from the sheet.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      matches: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
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
          additionalProperties: false,
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
          additionalProperties: false,
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

const MATCH_INSTRUCTIONS =
  "Match each sheet row to exactly one roster member by name, tolerating nicknames, " +
  "reordered first/last names, casing, and minor misspellings. Determine each person's " +
  "status (present/absent/traveled/excused) from the row (treat ticks/present/P/yes as " +
  "present; blanks/absent/A as absent). Do not invent members, and never use a roster_id " +
  "that is not in the roster above. Put rows you cannot confidently match in " +
  "unmatched_sheet_rows, and roster members with no corresponding row in " +
  "roster_not_on_sheet. Report your result via the tool.";

function rosterPrompt(roster: RosterMember[]): string {
  return (
    "ROSTER (match against these — use the exact `id` for roster_id):\n" +
    JSON.stringify(roster, null, 2)
  );
}

function extractProposal(response: Anthropic.Message): AiProposal {
  // A truncated response yields half-written JSON, which used to surface as a
  // generic shape error. Name it so the operator sees the real cause.
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "The sheet is too large to map in one pass — the parser ran out of output room. " +
        "Split the sheet into smaller files and upload them separately."
    );
  }
  if (response.stop_reason === "refusal") {
    throw new Error("The parser declined to process this file.");
  }

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

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured on the server, so sheets cannot be parsed automatically."
    );
  }
  return new Anthropic({ apiKey });
}

/**
 * Calls Claude (server-side) to map sheet rows to the roster (Section 12).
 * Uses forced tool use for strict JSON. Model is pinned in constants.
 *
 * The roster is sent in chunks (AUDIT ATT-3): the whole roster plus the whole
 * sheet used to go into one prompt with an 8k output cap, so a large team
 * silently truncated the tool response mid-JSON and the caller fell back to an
 * empty "review everything by hand" proposal.
 */
export async function parseAttendance(
  rows: Record<string, unknown>[],
  roster: RosterMember[]
): Promise<AiProposal> {
  if (roster.length === 0) {
    return { matches: [], unmatched_sheet_rows: [], roster_not_on_sheet: [] };
  }

  const anthropic = client();
  const sheetJson = JSON.stringify(rows, null, 2);
  const groups = chunk(roster, PARSE_ROSTER_CHUNK);

  const parts: AiProposal[] = [];
  for (const group of groups) {
    const prompt =
      "You are mapping a church media team's weekly attendance sheet to the member roster.\n\n" +
      rosterPrompt(group) +
      "\n\nSHEET ROWS (each row represents one person's attendance; `__sheet` names the " +
      "workbook tab the row came from and is not part of the person's data):\n" +
      sheetJson +
      "\n\nInstructions: " +
      MATCH_INSTRUCTIONS;

    const response = await anthropic.messages.create({
      model: ATTENDANCE_PARSE_MODEL,
      max_tokens: PARSE_MAX_TOKENS,
      tools: [PROPOSAL_TOOL],
      tool_choice: { type: "tool", name: PROPOSAL_TOOL.name },
      messages: [{ role: "user", content: prompt }],
    });

    parts.push(extractProposal(response));
  }

  return mergeProposals(parts, roster);
}

export interface AttendanceImage {
  base64: string;
  mediaType: ImageMediaType;
}

/**
 * Reads attendance from PHOTOS of a sheet/register (Claude vision) and maps it
 * to the roster — same strict tool-use JSON as the spreadsheet path. Lets the
 * secretary snap a picture instead of typing up a spreadsheet (Section 12).
 *
 * Accepts several images so a multi-page register is one upload (AUDIT ATT-9),
 * and runs on the stronger vision model since handwriting is the hardest call
 * we make and the one a human otherwise corrects by hand.
 */
export async function parseAttendanceImages(
  images: AttendanceImage[],
  roster: RosterMember[]
): Promise<AiProposal> {
  if (images.length === 0) throw new Error("No image to read.");
  if (roster.length === 0) {
    return { matches: [], unmatched_sheet_rows: [], roster_not_on_sheet: [] };
  }

  const anthropic = client();
  const groups = chunk(roster, PARSE_ROSTER_CHUNK);

  const parts: AiProposal[] = [];
  for (const group of groups) {
    const prompt =
      `The ${images.length === 1 ? "image is a photo" : `${images.length} images are photos`} ` +
      "of a church media team's attendance sheet or register (it may be printed or " +
      "handwritten). Read every page.\n\n" +
      rosterPrompt(group) +
      "\n\nRead every person listed in the photo(s). A tick/check/'P'/'present'/highlight " +
      "means present; blank, dash, 'A', or crossed-out means absent; note 'traveled'/" +
      "'excused' if written. " +
      MATCH_INSTRUCTIONS;

    const response = await anthropic.messages.create({
      model: ATTENDANCE_VISION_MODEL,
      max_tokens: PARSE_MAX_TOKENS,
      tools: [PROPOSAL_TOOL],
      tool_choice: { type: "tool", name: PROPOSAL_TOOL.name },
      messages: [
        {
          role: "user",
          content: [
            ...images.map((img) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: img.mediaType,
                data: img.base64,
              },
            })),
            { type: "text" as const, text: prompt },
          ],
        },
      ],
    });

    parts.push(extractProposal(response));
  }

  return mergeProposals(parts, roster);
}
