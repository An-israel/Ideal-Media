import type { AbsenceReason as DbAbsenceReason } from "@/lib/database.types";

/**
 * The absentee categories, taken verbatim from the department's own report.
 *
 * `heading` is what appears in the generated report, so a message pasted into
 * the Pastors' chat reads exactly like the hand-written one always has. `label`
 * is the shorter form used in the app's dropdowns.
 *
 * `aliases` exist because the headings drift between weeks — the same category
 * has appeared as "Withdrawn", "Withdrew / Opted Out" and bare "WITHDRAWN" —
 * and the paste parser has to recognise all of them.
 */
export const ABSENCE_REASONS = [
  {
    value: "illness",
    label: "Illness",
    heading: "Absent Due to Illness",
    aliases: ["illness", "absent due to illness", "sick", "sickness", "health"],
  },
  {
    value: "travelled",
    label: "Travelled",
    heading: "Travelled",
    aliases: ["travelled", "traveled", "travel", "out of town"],
  },
  {
    value: "academic",
    label: "Academic / school",
    heading: "Academic/School Engagements",
    aliases: [
      "academic",
      "academic/school engagements",
      "academic / school engagements",
      "academics",
      "school",
      "school engagements",
      "exams",
    ],
  },
  {
    value: "on_it",
    label: "On IT",
    heading: "On IT",
    aliases: ["on it", "it", "industrial training", "siwes", "internship", "externship"],
  },
  {
    value: "unreachable",
    label: "Unreachable",
    heading: "Unreachable",
    aliases: ["unreachable", "not reachable", "could not reach", "number not connecting"],
  },
  {
    value: "not_responding",
    label: "Not responding",
    heading: "Not Responding",
    aliases: ["not responding", "no response", "didn't respond", "did not respond"],
  },
  {
    value: "no_valid_reason",
    label: "No valid reason",
    heading: "No Valid Reason",
    aliases: ["no valid reason", "no excuse", "no reason", "invalid reason"],
  },
  {
    value: "other",
    label: "Other",
    heading: "Other Reasons",
    aliases: ["other", "other reasons", "others", "miscellaneous"],
  },
  {
    value: "withdrawn",
    label: "Withdrawn",
    heading: "Withdrawn",
    aliases: [
      "withdrawn",
      "withdrew",
      "withdrew / opted out",
      "withdrew/opted out",
      "opted out",
      "withdrawal",
    ],
  },
  {
    value: "inconsistent",
    label: "Inconsistent",
    heading: "Inconsistent",
    aliases: ["inconsistent", "inconsistency", "irregular"],
  },
] as const;

export type AbsenceReason = (typeof ABSENCE_REASONS)[number]["value"];

// The database has its own copy of this union (it is a Postgres enum, mirrored
// in database.types.ts). These two drifting apart would let a value reach the
// column that the enum rejects, at runtime, in production. Assert they are the
// same set at compile time instead.
type Assert<A extends B, B> = A;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _SameAsDatabase = Assert<AbsenceReason, DbAbsenceReason> &
  Assert<DbAbsenceReason, AbsenceReason>;

/** Report order — the order the headings appear in the generated message. */
export const ABSENCE_REASON_ORDER: AbsenceReason[] = ABSENCE_REASONS.map((r) => r.value);

const BY_VALUE = new Map(ABSENCE_REASONS.map((r) => [r.value as string, r]));

export function reasonHeading(value: AbsenceReason): string {
  return BY_VALUE.get(value)?.heading ?? value;
}

export function reasonLabel(value: AbsenceReason): string {
  return BY_VALUE.get(value)?.label ?? value;
}

/**
 * Matches a heading line from a pasted report to a category.
 *
 * Tolerant on purpose: the real reports vary the wording, the capitalisation
 * and the punctuation between weeks, and a heading we fail to recognise would
 * silently drop every name underneath it.
 */
export function matchReason(rawHeading: string): AbsenceReason | null {
  const cleaned = rawHeading
    .toLowerCase()
    // Drop the trailing count — "Absent Due to Illness: 3" / "INCONSISTENT 5".
    .replace(/[:\-–—]?\s*\(?\d+\s*(total)?\)?\s*$/i, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[:.]+$/, "")
    .trim();
  if (!cleaned) return null;

  for (const r of ABSENCE_REASONS) {
    if (r.aliases.some((a) => a === cleaned)) return r.value;
  }
  // Fall back to containment, longest alias first so "on it" doesn't win over
  // "industrial training" and "other" doesn't swallow "other reasons".
  const byLength = ABSENCE_REASONS.flatMap((r) =>
    r.aliases.map((a) => ({ value: r.value, alias: a }))
  ).sort((a, b) => b.alias.length - a.alias.length);
  for (const { value, alias } of byLength) {
    if (cleaned.includes(alias)) return value;
  }
  return null;
}
