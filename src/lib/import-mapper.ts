import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ATTENDANCE_PARSE_MODEL } from "@/lib/constants";

/**
 * Column-mapping results, memoised per server instance on the header set
 * (AUDIT PERF-5). Sheet layouts rarely change between imports, so re-asking
 * the model every time is latency and spend on a fully cacheable answer.
 */
const mapCache = new Map<string, unknown>();

function cacheKey(kind: string, headers: string[]): string {
  return `${kind}:${[...headers].map((h) => h.trim().toLowerCase()).sort().join("|")}`;
}

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured on the server, so columns cannot be mapped automatically."
    );
  }
  return new Anthropic({ apiKey });
}

export interface MemberColumnMap {
  full_name: string;
  email: string;
  phone: string;
  whatsapp: string;
  primary_subunit: string;
  secondary_subunits: string;
  birthday: string;
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
      birthday: { type: "string", description: "Header for birthday / date of birth (empty string if none)." },
    },
    required: ["full_name", "email", "phone", "whatsapp", "primary_subunit", "secondary_subunits", "birthday"],
  },
};

/**
 * Uses Claude to map a messy spreadsheet's columns to our member fields, so the
 * secretary doesn't have to rename headers. Returns the exact header text for
 * each field (or "" if the sheet has no matching column).
 *
 * THROWS on failure — the caller catches and falls back to header heuristics.
 * (The docstring used to claim it returned {} on any failure, which it never
 * did; callers that trusted that would have crashed.)
 */
export async function mapMemberColumns(
  headers: string[],
  sampleRows: Record<string, unknown>[]
): Promise<MemberColumnMap> {
  const key = cacheKey("member", headers);
  const cached = mapCache.get(key);
  if (cached) return cached as MemberColumnMap;

  const anthropic = client();

  const prompt =
    "A spreadsheet of church media team members has these column headers:\n" +
    JSON.stringify(headers) +
    "\n\nA few sample rows:\n" +
    JSON.stringify(sampleRows.slice(0, 5), null, 2) +
    "\n\nMap each target field to the EXACT header text that best matches it (copy " +
    "the header exactly, including case and spacing). If no column fits a field, use " +
    "an empty string. Ignore every other column. Report via the tool.";

  const res = await anthropic.messages.create({
    model: ATTENDANCE_PARSE_MODEL,
    max_tokens: 1024,
    tools: [MAP_TOOL],
    tool_choice: { type: "tool", name: MAP_TOOL.name },
    messages: [{ role: "user", content: prompt }],
  });

  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("No column mapping returned.");
  const m = block.input as Partial<MemberColumnMap>;
  const mapped: MemberColumnMap = {
    full_name: String(m.full_name ?? ""),
    email: String(m.email ?? ""),
    phone: String(m.phone ?? ""),
    whatsapp: String(m.whatsapp ?? ""),
    primary_subunit: String(m.primary_subunit ?? ""),
    secondary_subunits: String(m.secondary_subunits ?? ""),
    birthday: String(m.birthday ?? ""),
  };
  mapCache.set(key, mapped);
  return mapped;
}

/** Same idea as mapMemberColumns, for a past-attendance sheet (one row per record). */
export interface AttendanceColumnMap {
  email: string;
  name: string;
  date: string;
  status: string;
}

const ATTENDANCE_MAP_TOOL: Anthropic.Tool = {
  name: "map_attendance_columns",
  description:
    "Map each target attendance field to the spreadsheet column header that best matches it.",
  input_schema: {
    type: "object",
    properties: {
      email: { type: "string", description: "Header for the member's email (empty string if none)." },
      name: { type: "string", description: "Header for the member's name (empty string if none)." },
      date: { type: "string", description: "Header for the service date (empty string if none)." },
      status: { type: "string", description: "Header for present/absent status (empty string if none)." },
    },
    required: ["email", "name", "date", "status"],
  },
};

/** Same idea as mapMemberColumns, for a past-attendance sheet (one row per record). */
export async function mapAttendanceColumns(
  headers: string[],
  sampleRows: Record<string, unknown>[]
): Promise<AttendanceColumnMap> {
  const key = cacheKey("attendance", headers);
  const cached = mapCache.get(key);
  if (cached) return cached as AttendanceColumnMap;

  const anthropic = client();

  const prompt =
    "A spreadsheet of past attendance (one row per person per service) has these headers:\n" +
    JSON.stringify(headers) +
    "\n\nA few sample rows:\n" +
    JSON.stringify(sampleRows.slice(0, 5), null, 2) +
    "\n\nMap each target field to the EXACT header text that best matches it (copy it " +
    "exactly). If no column fits, use an empty string. Ignore every other column. " +
    "Report via the tool.";

  const res = await anthropic.messages.create({
    model: ATTENDANCE_PARSE_MODEL,
    max_tokens: 1024,
    tools: [ATTENDANCE_MAP_TOOL],
    tool_choice: { type: "tool", name: ATTENDANCE_MAP_TOOL.name },
    messages: [{ role: "user", content: prompt }],
  });

  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("No column mapping returned.");
  const m = block.input as Partial<AttendanceColumnMap>;
  const mapped: AttendanceColumnMap = {
    email: String(m.email ?? ""),
    name: String(m.name ?? ""),
    date: String(m.date ?? ""),
    status: String(m.status ?? ""),
  };
  mapCache.set(key, mapped);
  return mapped;
}

const SUBUNIT_MAP_TOOL: Anthropic.Tool = {
  name: "map_subunits",
  description: "Match each spreadsheet subunit/unit value to the existing subunit it best corresponds to.",
  input_schema: {
    type: "object",
    properties: {
      mappings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            value: { type: "string", description: "The value as written in the sheet." },
            subunit: { type: "string", description: "The EXACT existing subunit name it matches, or empty string if none is reasonable." },
          },
          required: ["value", "subunit"],
        },
      },
    },
    required: ["mappings"],
  },
};

/**
 * Maps the messy subunit/unit values found in a sheet to our existing subunit
 * names (e.g. "Utility (Technical in Media)" → "Utility (Videography &
 * Technical)"). Returns a lowercase-value → existing-name map.
 *
 * Returns {} when the model doesn't answer with the tool, but THROWS on an API
 * failure — callers catch and fall back to heuristic matching.
 */
export async function mapSubunitValues(
  values: string[],
  existingSubunits: string[]
): Promise<Record<string, string>> {
  if (values.length === 0) return {};
  const key = cacheKey("subunits", [...values, ...existingSubunits]);
  const cached = mapCache.get(key);
  if (cached) return cached as Record<string, string>;

  const anthropic = client();

  const prompt =
    "These are the only existing subunits (choose from these EXACT names):\n" +
    JSON.stringify(existingSubunits) +
    "\n\nA spreadsheet uses these subunit/unit values:\n" +
    JSON.stringify(values) +
    "\n\nFor each value, choose the existing subunit it best corresponds to (copy the " +
    "exact existing name). Use an empty string only if truly none is reasonable. " +
    "Report via the tool.";

  const res = await anthropic.messages.create({
    model: ATTENDANCE_PARSE_MODEL,
    max_tokens: 2048,
    tools: [SUBUNIT_MAP_TOOL],
    tool_choice: { type: "tool", name: SUBUNIT_MAP_TOOL.name },
    messages: [{ role: "user", content: prompt }],
  });

  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") return {};
  const out: Record<string, string> = {};
  const data = block.input as { mappings?: { value: string; subunit: string }[] };
  for (const item of data.mappings ?? []) {
    if (item.value) out[item.value.trim().toLowerCase()] = item.subunit ?? "";
  }
  mapCache.set(key, out);
  return out;
}
