/**
 * Matches names written in a pasted report to people on the roster.
 *
 * Nigerian names in these reports are written in whatever order the person
 * typing them remembers — "Opara Chidumebi Elisheva" one week, "Elisheva
 * Opara" the next — and carry apostrophes ("God'swill"), hyphens
 * ("Austin-Nwaroh") and occasional extra middle names. So comparison is on the
 * SET of name tokens, not the string.
 *
 * The important property is that an uncertain match is returned as uncertain
 * rather than guessed. A wrong match marks the wrong person absent; a missed
 * match leaves someone marked present who was not there. Both are worse than
 * asking, which is why every result carries its confidence and the paste flow
 * shows them for confirmation before anything is written.
 */

export interface Candidate {
  id: string;
  fullName: string;
}

export type MatchKind = "exact" | "same-tokens" | "subset" | "ambiguous" | "none";

export interface NameMatch {
  kind: MatchKind;
  /** Set unless kind is 'ambiguous' or 'none'. */
  id: string | null;
  fullName: string | null;
  /** Populated when more than one person fits, so a human can choose. */
  options: Candidate[];
}

/** Lowercases, strips punctuation, collapses whitespace. */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[ ​⁠﻿]/g, " ")
    // Apostrophes join a name ("God'swill" → "godswill"); hyphens separate it
    // ("Austin-Nwaroh" → two tokens), which is how people vary them in writing.
    .replace(/['’`]/g, "")
    .replace(/[-–—_.,/\\]+/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function nameTokens(raw: string): string[] {
  const n = normalizeName(raw);
  return n ? n.split(" ") : [];
}

function tokenKey(raw: string): string {
  return [...new Set(nameTokens(raw))].sort().join(" ");
}

export interface NameIndex {
  byExact: Map<string, Candidate[]>;
  byTokens: Map<string, Candidate[]>;
  all: Candidate[];
}

export function buildNameIndex(people: Candidate[]): NameIndex {
  const byExact = new Map<string, Candidate[]>();
  const byTokens = new Map<string, Candidate[]>();
  for (const p of people) {
    const e = normalizeName(p.fullName);
    const t = tokenKey(p.fullName);
    if (e) byExact.set(e, [...(byExact.get(e) ?? []), p]);
    if (t) byTokens.set(t, [...(byTokens.get(t) ?? []), p]);
  }
  return { byExact, byTokens, all: people };
}

const NONE: NameMatch = { kind: "none", id: null, fullName: null, options: [] };

function hit(kind: MatchKind, c: Candidate): NameMatch {
  return { kind, id: c.id, fullName: c.fullName, options: [] };
}

function ambiguous(options: Candidate[]): NameMatch {
  return { kind: "ambiguous", id: null, fullName: null, options };
}

export function matchName(written: string, index: NameIndex): NameMatch {
  const tokens = nameTokens(written);
  if (tokens.length === 0) return NONE;

  const exact = index.byExact.get(normalizeName(written));
  if (exact?.length === 1) return hit("exact", exact[0]);
  if (exact && exact.length > 1) return ambiguous(exact);

  // Same names, different order.
  const sameTokens = index.byTokens.get(tokenKey(written));
  if (sameTokens?.length === 1) return hit("same-tokens", sameTokens[0]);
  if (sameTokens && sameTokens.length > 1) return ambiguous(sameTokens);

  // Every token written appears in the roster name (a shortened form), or
  // every roster token appears in what was written (extra middle names given).
  const want = new Set(tokens);
  const subset = index.all.filter((p) => {
    const have = new Set(nameTokens(p.fullName));
    if (have.size === 0) return false;
    const writtenInRoster = [...want].every((t) => have.has(t));
    const rosterInWritten = [...have].every((t) => want.has(t));
    return writtenInRoster || rosterInWritten;
  });

  // A single surname is not enough to identify somebody.
  if (subset.length === 1 && tokens.length >= 2) return hit("subset", subset[0]);
  if (subset.length > 1) return ambiguous(subset);

  return NONE;
}

export interface ResolvedName<T> {
  row: T;
  written: string;
  match: NameMatch;
}

/**
 * Matches a batch, and refuses to use the same person twice.
 *
 * Without this, two different spellings in one report can both resolve to one
 * roster entry — silently losing an absentee and marking them present.
 */
export function matchAll<T extends { name: string }>(
  rows: T[],
  index: NameIndex
): ResolvedName<T>[] {
  const taken = new Map<string, string>();
  const out: ResolvedName<T>[] = [];
  for (const row of rows) {
    const m = matchName(row.name, index);
    if (m.id && taken.has(m.id)) {
      out.push({
        row,
        written: row.name,
        match: {
          kind: "ambiguous",
          id: null,
          fullName: null,
          options: m.fullName ? [{ id: m.id, fullName: m.fullName }] : [],
        },
      });
      continue;
    }
    if (m.id) taken.set(m.id, row.name);
    out.push({ row, written: row.name, match: m });
  }
  return out;
}
