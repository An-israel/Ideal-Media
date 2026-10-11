import { matchReason, type AbsenceReason } from "@/lib/absence-reasons";

/**
 * Parses a pasted absentee report into structured rows.
 *
 * Welfare already produce this text every week by hand, so the fastest way in
 * is to let them paste it rather than re-tick 101 boxes. Everyone named is
 * absent under the heading they sit beneath; everyone NOT named is present.
 *
 * The input is genuinely messy — it has been copied out of WhatsApp, so it
 * carries bold markers, two different bullet characters, doubled bullets
 * ("* - Name"), and invisible word-joiner characters (U+2060, U+200B, U+00A0)
 * that a naive split leaves glued to the name. All of that is stripped before
 * matching, because a name that fails to match is a person silently marked
 * present when they were absent.
 */

export interface ParsedAbsentee {
  /** The name as written in the report. */
  name: string;
  /** The detail after the colon, if any. */
  note: string | null;
  reason: AbsenceReason;
  /** 1-based line number in the pasted text, for error reporting. */
  line: number;
}

export interface ParsedReport {
  absentees: ParsedAbsentee[];
  /** Counts the report declared per heading, e.g. "Illness: 3" → 3. */
  declared: { reason: AbsenceReason; count: number; heading: string }[];
  /** The "Total Members:" line, when present. */
  totalMembers: number | null;
  declaredPresent: number | null;
  declaredAbsent: number | null;
  /** Lines under no recognised heading — surfaced rather than dropped. */
  orphanLines: { line: number; text: string }[];
  /** Headings we could not map to a category. */
  unknownHeadings: { line: number; text: string }[];
}

/** Invisible characters WhatsApp copy-paste leaves behind. */
const INVISIBLE = /[ ​‌‍⁠﻿‪-‮]/g;

function clean(s: string): string {
  return s.replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
}

/** Strips markdown-ish emphasis WhatsApp uses (*bold*, _italic_). */
function stripEmphasis(s: string): string {
  return s.replace(/[*_~`]/g, "").trim();
}

/**
 * Removes any run of leading bullet characters.
 *
 * Real lines include "- Name", "* *Heading*", "* - Name" and "- - Name", so a
 * single strip is not enough.
 */
function stripBullets(s: string): string {
  let out = s;
  for (;;) {
    const next = out.replace(/^\s*[-*•·–—]\s*/, "");
    if (next === out) return out.trim();
    out = next;
  }
}

// The colon must follow the word immediately. Without that anchor, "Absent Due
// to Illness: 7" matches /^absent/ and is eaten as the summary total, which
// orphans every name beneath that heading.
const SUMMARY_PATTERNS: { key: keyof ParsedReport; re: RegExp }[] = [
  { key: "totalMembers", re: /^total\s+members?\s*:/i },
  { key: "declaredPresent", re: /^present\s*:/i },
  { key: "declaredAbsent", re: /^absent\s*:/i },
];

function trailingCount(s: string): number | null {
  const m = s.match(/(\d+)\s*(total)?\s*\)?\s*$/i);
  return m ? Number(m[1]) : null;
}

export function parseAbsenteeReport(raw: string): ParsedReport {
  const out: ParsedReport = {
    absentees: [],
    declared: [],
    totalMembers: null,
    declaredPresent: null,
    declaredAbsent: null,
    orphanLines: [],
    unknownHeadings: [],
  };

  let current: AbsenceReason | null = null;
  const lines = raw.split(/\r?\n/);
  const seen = new Set<string>();

  // "On IT: 7" and "Withdrawn: 5" appear twice over: once in the header block
  // as a bare count, and again lower down as a real heading with names under
  // it. Only the ones after the "Absentee Categorization" marker open a
  // category. When a report has no such marker, every heading counts.
  const marker = lines.findIndex((l) => /absentee\s+categori/i.test(l));
  const categorizationStartsAt = marker === -1 ? -1 : marker;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = clean(lines[i]);
    if (!line) continue;

    const bare = stripEmphasis(stripBullets(line));
    if (!bare || /^-+$/.test(bare)) continue;

    // Skip the greeting and title.
    if (/^good\s+(morning|afternoon|evening)/i.test(bare)) continue;
    if (/attendance\s*&?\s*absentee\s+report/i.test(bare)) continue;
    if (/^(sunday|wednesday|monday|tuesday|thursday|friday|saturday)\b.*report\s*:/i.test(bare)) {
      continue;
    }

    // Summary lines: "Total Members: 101", "Present: 49", "Absent: 52".
    const summary = SUMMARY_PATTERNS.find((p) => p.re.test(bare));
    if (summary && /:\s*\d+\s*$/.test(bare)) {
      const n = trailingCount(bare);
      if (n !== null) {
        (out[summary.key] as number | null) = n;
        continue;
      }
    }

    if (/^absentee\s+categori/i.test(bare)) {
      current = null;
      continue;
    }

    // A heading carries ONLY a count after its colon ("Travelled: 4"), or no
    // colon at all and a trailing count that names a known category
    // ("INCONSISTENT 5"). A person's note may also end in a digit — "GS class
    // ends by 6" — which must not be mistaken for a heading, because doing so
    // drops every name listed after it.
    const colonAt = bare.indexOf(":");
    const afterColon = colonAt === -1 ? null : bare.slice(colonAt + 1).trim();
    const isHeadingShaped =
      (afterColon !== null && /^\(?\d+\s*(total)?\)?$/i.test(afterColon)) ||
      (colonAt === -1 && /\d\s*$/.test(bare) && matchReason(bare) !== null);

    if (isHeadingShaped) {
      if (categorizationStartsAt !== -1 && i < categorizationStartsAt) {
        // Still in the header block: a count, not a category.
        continue;
      }
      const reason = matchReason(bare);
      if (reason) {
        current = reason;
        const count = trailingCount(bare);
        out.declared.push({ reason, count: count ?? 0, heading: bare });
      } else {
        out.unknownHeadings.push({ line: lineNo, text: bare });
        current = null;
      }
      continue;
    }

    // Otherwise it's a person.
    const colon = bare.indexOf(":");
    const name = clean(colon === -1 ? bare : bare.slice(0, colon));
    const note = colon === -1 ? null : clean(bare.slice(colon + 1)) || null;
    if (!name) continue;

    if (!current) {
      out.orphanLines.push({ line: lineNo, text: bare });
      continue;
    }

    // The same person can be typed twice; keep the first, which carries the
    // heading they were first filed under.
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.absentees.push({ name, note, reason: current, line: lineNo });
  }

  return out;
}

export interface CountCheck {
  reason: AbsenceReason;
  heading: string;
  declared: number;
  found: number;
}

/**
 * Compares each heading's stated count against the names actually listed
 * beneath it.
 *
 * Both sample reports balanced exactly, which means the team counts carefully —
 * so a mismatch is a real signal that a name was dropped in the copy, not noise
 * worth hiding.
 */
export function checkDeclaredCounts(report: ParsedReport): CountCheck[] {
  const found = new Map<AbsenceReason, number>();
  for (const a of report.absentees) {
    found.set(a.reason, (found.get(a.reason) ?? 0) + 1);
  }
  return report.declared
    .map((d) => ({
      reason: d.reason,
      heading: d.heading,
      declared: d.count,
      found: found.get(d.reason) ?? 0,
    }))
    .filter((c) => c.declared > 0 && c.declared !== c.found);
}
