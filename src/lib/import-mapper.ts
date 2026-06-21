import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ATTENDANCE_PARSE_MODEL } from "@/lib/constants";

export interface MemberColumnMap {
  full_name: string;
  email: string;
  phone: string;
  whatsapp: string;
  primary_subunit: string;
  secondary_subunits: string;
}

const MAP_TOOL: Anthropic.Tool = {
  name: "map_columns",
  description:
    "Map each target member field to the spreadsheet column header that best matches it.",
  input_schema: {
    type: "object",
    properties: {
      full_name: { type: "string", description: "Header for the person's full name (empty string if none)." },
      email: { type: "string", description: "Header for email address (empty string if none)." },
      phone: { type: "string", description: "Header for phone number (empty string if none)." },
      whatsapp: { type: "string", description: "Header for WhatsApp number; may be the same as phone (empty string if none)." },
      primary_subunit: { type: "string", description: "Header for the person's main team/unit/department (empty string if none)." },
      secondary_subunits: { type: "string", description: "Header for any additional units, if present (empty string if none)." },
    },
    required: ["full_name", "email", "phone", "whatsapp", "primary_subunit", "secondary_subunits"],
  },
};

/**
 * Uses Claude to map a messy spreadsheet's columns to our member fields, so the
 * secretary doesn't have to rename headers. Returns the exact header text for
 * each field (or "" if the sheet has no matching column). Falls back to {} on
 * any failure so the caller can use header heuristics instead.
 */
export async function mapMemberColumns(
  headers: string[],
  sampleRows: Record<string, unknown>[]
): Promise<MemberColumnMap> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const prompt =
    "A spreadsheet of church media team members has these column headers:\n" +
    JSON.stringify(headers) +
    "\n\nA few sample rows:\n" +
    JSON.stringify(sampleRows.slice(0, 5), null, 2) +
    "\n\nMap each target field to the EXACT header text that best matches it (copy " +
    "the header exactly, including case and spacing). If no column fits a field, use " +
    "an empty string. Ignore every other column. Report via the tool.";

  const res = await client.messages.create({
    model: ATTENDANCE_PARSE_MODEL,
    max_tokens: 1024,
    tools: [MAP_TOOL],
    tool_choice: { type: "tool", name: MAP_TOOL.name },
    messages: [{ role: "user", content: prompt }],
  });

  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("No column mapping returned.");
  const m = block.input as Partial<MemberColumnMap>;
  return {
    full_name: String(m.full_name ?? ""),
    email: String(m.email ?? ""),
    phone: String(m.phone ?? ""),
    whatsapp: String(m.whatsapp ?? ""),
    primary_subunit: String(m.primary_subunit ?? ""),
    secondary_subunits: String(m.secondary_subunits ?? ""),
  };
}
