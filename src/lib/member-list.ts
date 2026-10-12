import { phoneKey } from "@/lib/phone";

/**
 * Parses the official media members list — the numbered "Name - phone" roll
 * that the department keeps by hand.
 *
 * Written to survive the real thing rather than an idealised version of it:
 * numbering is sometimes "59." with no space, some entries carry no phone at
 * all, one ends in a bare trailing hyphen ("Ezechi Chinwe-"), and names use
 * apostrophes and hyphens that must stay part of the name.
 *
 * Getting this wrong is not cosmetic. This list decides who keeps access, so a
 * mangled name is a person wrongly cut off.
 */

export interface ListedMember {
  /** 1-based position as written, for pointing at a line in the UI. */
  position: number;
  name: string;
  /** Digits only, or null when the entry carried no number. */
  phone: string | null;
  /** Normalised for comparison; null when there is no usable number. */
  phoneKey: string | null;
}

export interface ParsedMemberList {
  members: ListedMember[];
  /** Lines that looked like entries but could not be read. */
  unreadable: { line: number; text: string }[];
  /** Entries whose name is contained in another entry's name. */
  possibleDuplicates: { a: ListedMember; b: ListedMember }[];
  /** Entries with no phone number — matching them is name-only, so riskier. */
  withoutPhone: ListedMember[];
  /** Numbers that do not look like a Nigerian mobile. */
  suspectPhones: ListedMember[];
}

const INVISIBLE = /[ ​‌‍⁠﻿]/g;

function clean(s: string): string {
  return s.replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
}

export function normalizeMemberName(raw: string): string {
  return clean(raw)
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[-–—_.,/\\]+/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokenSet(raw: string): Set<string> {
  const n = normalizeMemberName(raw);
  return new Set(n ? n.split(" ") : []);
}

/**
 * A Nigerian mobile is 10 digits beginning 7, 8 or 9 once the trunk 0 or the
 * +234 country code is stripped. Anything else is flagged rather than silently
 * used as a matching key.
 */
export function looksLikeNigerianMobile(digits: string): boolean {
  let d = digits;
  if (d.startsWith("234")) d = d.slice(3);
  else if (d.startsWith("0")) d = d.slice(1);
  return d.length === 10 && "789".includes(d[0]);
}

/**
 * Separates a trailing phone number from a name.
 *
 * The lists arrive in several shapes — "Name - 08012345678" from the master
 * roll, "Name<tab>09034420395" from the unit sheets, and "Moses +234 704 111
 * 8511" with the number spaced out. So the number is found by walking back
 * from the end collecting anything that could be part of one, rather than by
 * splitting on a separator that is not always there.
 *
 * Walking from the end also protects hyphenated surnames: splitting on the
 * first hyphen would cut "Austin-Nwaroh" and "Aja-Aki" in half, and splitting
 * on the last would do the same to a name with no number after it.
 */
export function splitNameAndPhone(raw: string): { name: string; phone: string | null } {
  const text = raw.trim();
  // A bare trailing hyphen is a number that was never written down, as in the
  // truncated "Ezechi Chinwe-".
  if (/-\s*$/.test(text)) {
    return { name: text.replace(/[-\s]+$/, "").trim(), phone: null };
  }

  const parts = text.split(/\s+/);
  let i = parts.length;
  let digits = 0;
  while (i > 0) {
    const part = parts[i - 1];
    // Only a run made purely of number punctuation can belong to the phone.
    if (!/^[+(]?[\d][\d()+-]*$/.test(part)) break;
    digits += (part.match(/\d/g) ?? []).length;
    i--;
    // A Nigerian number never needs more than four groups; stopping here keeps
    // a name that happens to end in a digit from being eaten.
    if (parts.length - i >= 5) break;
  }

  if (digits >= 7 && i > 0) {
    const name = parts.slice(0, i).join(" ").replace(/[-\s]+$/, "").trim();
    if (name) {
      return { name, phone: parts.slice(i).join("").replace(/\D/g, "") };
    }
  }
  return { name: text.replace(/[-\s]+$/, "").trim(), phone: null };
}

export function parseMemberList(raw: string): ParsedMemberList {
  const members: ListedMember[] = [];
  const unreadable: { line: number; text: string }[] = [];

  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = clean(lines[i]);
    if (!line) continue;

    // "12. Name - 08012345678", tolerating "12." with no following space.
    const m = /^(\d{1,4})\s*[.)]\s*(.*)$/.exec(line);
    if (!m) {
      unreadable.push({ line: i + 1, text: line });
      continue;
    }
    const position = Number(m[1]);
    const rest = clean(m[2]);
    if (!rest) {
      unreadable.push({ line: i + 1, text: line });
      continue;
    }

    const { name: parsedName, phone } = splitNameAndPhone(rest);
    let name = parsedName;

    name = clean(name);
    if (!name) {
      unreadable.push({ line: i + 1, text: line });
      continue;
    }

    members.push({
      position,
      name,
      phone,
      // Only a plausible number becomes a matching key. A malformed one would
      // otherwise match the wrong person, or nobody, without saying why.
      phoneKey: phone && looksLikeNigerianMobile(phone) ? phoneKey(phone) : null,
    });
  }

  // A name wholly contained in another is the shape a duplicate takes here —
  // "Owan Flourish" against "Owan Flourish Worma".
  const possibleDuplicates: { a: ListedMember; b: ListedMember }[] = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = nameTokenSet(members[i].name);
      const b = nameTokenSet(members[j].name);
      if (a.size === 0 || b.size === 0) continue;
      const aInB = [...a].every((t) => b.has(t));
      const bInA = [...b].every((t) => a.has(t));
      if (aInB || bInA) possibleDuplicates.push({ a: members[i], b: members[j] });
    }
  }

  return {
    members,
    unreadable,
    possibleDuplicates,
    withoutPhone: members.filter((m) => !m.phone),
    suspectPhones: members.filter((m) => m.phone && !looksLikeNigerianMobile(m.phone)),
  };
}
