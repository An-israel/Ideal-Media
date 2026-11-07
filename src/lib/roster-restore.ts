import { phoneKey } from "@/lib/phone";
import { buildNameIndex, matchName, nameTokens, type Candidate } from "@/lib/name-match";

/** The words of a name, deduplicated and sorted — order carries no meaning here. */
function tokenKey(raw: string): string {
  return [...new Set(nameTokens(raw))].sort().join(" ");
}

/**
 * Who the department has written down, and who the site is missing.
 *
 * The members list and the six subunit sheets are the record of who is in the
 * department. This works out which of those people have no account at all, so
 * they can be created instead of being invisible to attendance and the
 * academy.
 *
 * The matching mirrors the SQL scripts exactly — a hand-checked spelling pair,
 * then the phone number, then the name — because the two must never disagree
 * about whether somebody exists. Disagreeing would mean creating a duplicate
 * of a real member.
 */

export interface SheetPerson {
  name: string;
  phone: string | null;
}

export interface SheetData {
  officialList: SheetPerson[];
  sheets: { unit: string; membership: string; members: SheetPerson[] }[];
  aliases: { sheet: string; official: string }[];
}

export interface AccountLike {
  id: string;
  fullName: string;
  phone: string | null;
  whatsappNumber: string | null;
}

export interface MissingPerson {
  name: string;
  phone: string | null;
  /** "Members list", or the subunits whose sheet names them. */
  sources: string[];
}

export interface RosterGap {
  missing: MissingPerson[];
  /** People on a sheet who do have an account — nothing to do for them. */
  present: number;
  /** Distinct people across the members list and every sheet. */
  total: number;
}

/** A person as the department wrote them, merged across the lists naming them. */
interface Entry {
  name: string;
  phone: string | null;
  sources: Set<string>;
}

/**
 * Collapses the lists into one person per human.
 *
 * Somebody can appear on the members list and on two sheets, spelled
 * differently each time and with a phone number on only one of them. Merging
 * on the phone number first, then the normalised name, is what stops that one
 * person being created three times.
 */
export function collectPeople(data: SheetData): Entry[] {
  const entries: Entry[] = [];
  const byPhone = new Map<string, Entry>();
  const byName = new Map<string, Entry>();

  // A sheet spelling that the department confirmed is somebody on the members
  // list is that person, not a second one.
  const officialFor = new Map(
    data.aliases.map((a) => [tokenKey(a.sheet), tokenKey(a.official)])
  );

  const add = (person: SheetPerson, source: string) => {
    const key = phoneKey(person.phone);
    // Keyed on the SET of words, not their order: the sheets write "Ohiero
    // Favour" and "Favour ohiero" for one person, and the rest of the app
    // already treats those as the same name.
    const canonical = officialFor.get(tokenKey(person.name)) ?? tokenKey(person.name);
    if (!canonical) return;

    const found = (key && byPhone.get(key)) || byName.get(canonical);
    if (found) {
      found.sources.add(source);
      // Keep the first phone number seen; a later blank must not erase it.
      if (!found.phone && person.phone) found.phone = person.phone;
      if (key) byPhone.set(key, found);
      byName.set(canonical, found);
      return;
    }

    const entry: Entry = { name: person.name, phone: person.phone, sources: new Set([source]) };
    entries.push(entry);
    if (key) byPhone.set(key, entry);
    byName.set(canonical, entry);
  };

  for (const p of data.officialList) add(p, "Members list");
  for (const s of data.sheets) for (const p of s.members) add(p, s.unit);
  return mergeShortenedNames(entries);
}

/**
 * Second pass: joins a shortened spelling to the fuller one.
 *
 * The first pass merges on the phone number or the exact name, which leaves
 * "Eze Oluchi" on the Video Editing sheet separate from "Eze Miracle Oluchi"
 * on the members list — neither carries a number and the names differ. They
 * are one person, and offering both for creation would make two accounts.
 *
 * Only a strict subset counts, both names need two words, and the match has to
 * be unique, so "Agbo Amarachi" merging into either of two Agbo Amarachis is
 * refused rather than guessed. Two different phone numbers mean two people
 * whatever the names look like.
 */
function mergeShortenedNames(entries: Entry[]): Entry[] {
  const tokensOf = (e: Entry) => new Set(nameTokens(e.name));
  const dropped = new Set<Entry>();

  for (const shorter of entries) {
    if (dropped.has(shorter)) continue;
    const want = tokensOf(shorter);
    if (want.size < 2) continue;

    const fits = entries.filter((longer) => {
      if (longer === shorter || dropped.has(longer)) return false;
      const have = tokensOf(longer);
      if (have.size <= want.size) return false;
      if (![...want].every((t) => have.has(t))) return false;
      const a = phoneKey(shorter.phone);
      const b = phoneKey(longer.phone);
      return !(a && b && a !== b);
    });

    if (fits.length !== 1) continue;
    const longer = fits[0];
    for (const src of shorter.sources) longer.sources.add(src);
    if (!longer.phone && shorter.phone) longer.phone = shorter.phone;
    dropped.add(shorter);
  }

  return entries.filter((e) => !dropped.has(e));
}

/** Everyone the department has written down who has no account on the site. */
export function findRosterGap(data: SheetData, accounts: AccountLike[]): RosterGap {
  const people = collectPeople(data);

  const index = buildNameIndex(
    accounts.map((a): Candidate => ({ id: a.id, fullName: a.fullName }))
  );
  const accountByPhone = new Map<string, AccountLike>();
  for (const a of accounts) {
    for (const raw of [a.phone, a.whatsappNumber]) {
      const key = phoneKey(raw);
      // One account reachable on two numbers is still one account, and a
      // number already claimed by another account is not a safe key.
      if (key && !accountByPhone.has(key)) accountByPhone.set(key, a);
    }
  }
  const officialFor = new Map(
    data.aliases.map((a) => [tokenKey(a.sheet), a.official])
  );

  const missing: MissingPerson[] = [];
  let present = 0;

  for (const person of people) {
    const key = phoneKey(person.phone);
    if (key && accountByPhone.has(key)) {
      present += 1;
      continue;
    }
    const spelling = officialFor.get(tokenKey(person.name)) ?? person.name;
    const m = matchName(spelling, index);
    // 'ambiguous' counts as present on purpose: several accounts fit, so one
    // of them is this person and creating another would be the duplicate this
    // whole function exists to avoid.
    if (m.kind !== "none") {
      present += 1;
      continue;
    }
    missing.push({
      name: person.name,
      phone: person.phone,
      sources: [...person.sources],
    });
  }

  missing.sort((a, b) => a.name.localeCompare(b.name));
  return { missing, present, total: people.length };
}
