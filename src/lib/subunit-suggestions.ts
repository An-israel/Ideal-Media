import { phoneKey } from "@/lib/phone";
import { buildNameIndex, matchName, nameTokens } from "@/lib/name-match";
import type { SheetData } from "@/lib/roster-restore";

/**
 * Working out which unit a member without one most likely belongs in.
 *
 * Two things left members with no primary subunit: accounts created from a
 * subunit sheet (made before their unit was set), and the assignment pass that
 * took everyone not on a sheet out of the unit they were in. The second was a
 * deletion, not a mark, so which unit they had held is not recorded anywhere.
 *
 * It can often still be read off what does remain:
 *
 *   1. The subunit sheets. A member named on the Production sheet belongs in
 *      Production — that is what the sheet is.
 *   2. Their course enrolments. Joining a primary subunit enrols a member in
 *      that subunit's courses, and those enrolments were not removed with the
 *      membership. Somebody enrolled in three Photography courses was in
 *      Photography.
 *
 * Every suggestion carries the evidence it came from, and nothing is assigned
 * here: the secretary sees the list and decides.
 */

export interface SuggestAccount {
  id: string;
  fullName: string;
  phone: string | null;
  whatsappNumber: string | null;
}

export interface SuggestSubunit {
  id: string;
  name: string;
  slug: string;
  category: string;
}

export interface Suggestion {
  userId: string;
  fullName: string;
  subunitId: string;
  subunitName: string;
  source: "sheet" | "courses";
  /** Why, in words a secretary can check. */
  evidence: string;
}

const tokenKey = (raw: string) => [...new Set(nameTokens(raw))].sort().join(" ");

/** Finds the subunit a sheet's heading refers to, by name or by slug. */
function subunitForSheet(unit: string, subunits: SuggestSubunit[]): SuggestSubunit | null {
  const want = tokenKey(unit);
  const slug = unit.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // The Technical unit was seeded as "Utility (Videography & Technical)" and
  // keeps the slug "utility" until the rename migration has been run.
  const slugs = slug === "technical" ? ["technical", "utility"] : [slug];
  return (
    subunits.find((s) => slugs.includes(s.slug)) ??
    subunits.find((s) => tokenKey(s.name) === want) ??
    null
  );
}

export function suggestSubunits(input: {
  /** Members on the roll with no primary subunit. */
  unassigned: SuggestAccount[];
  subunits: SuggestSubunit[];
  sheets: SheetData;
  /** One row per course a member is enrolled in, with that course's subunit. */
  enrollments: { userId: string; subunitId: string }[];
}): Suggestion[] {
  const primaryUnits = input.subunits.filter((s) => s.category === "primary");
  const byId = new Map(input.unassigned.map((a) => [a.id, a]));
  const out = new Map<string, Suggestion>();
  /** Members two different sheets both claim: neither is trusted. */
  const contested = new Set<string>();

  // ---- 1. the sheets -------------------------------------------------------
  const index = buildNameIndex(input.unassigned.map((a) => ({ id: a.id, fullName: a.fullName })));
  const byPhone = new Map<string, string>();
  for (const a of input.unassigned) {
    for (const raw of [a.phone, a.whatsappNumber]) {
      const key = phoneKey(raw);
      if (key && !byPhone.has(key)) byPhone.set(key, a.id);
    }
  }
  const officialFor = new Map(input.sheets.aliases.map((a) => [tokenKey(a.sheet), a.official]));

  for (const sheet of input.sheets.sheets) {
    // A secondary sheet says somebody is ALSO in that unit; it says nothing
    // about which unit counts them.
    if (sheet.membership !== "primary") continue;
    const subunit = subunitForSheet(sheet.unit, primaryUnits);
    if (!subunit) continue;

    for (const person of sheet.members) {
      const key = phoneKey(person.phone);
      let userId = key ? byPhone.get(key) ?? null : null;
      let how = "phone number";
      if (!userId) {
        const m = matchName(officialFor.get(tokenKey(person.name)) ?? person.name, index);
        // An ambiguous name is two members it could be, so it is nobody's.
        if (m.id && m.kind !== "ambiguous") {
          userId = m.id;
          how = "name";
        }
      }
      if (!userId || contested.has(userId)) continue;

      const existing = out.get(userId);
      if (existing && existing.subunitId !== subunit.id) {
        out.delete(userId);
        contested.add(userId);
        continue;
      }
      out.set(userId, {
        userId,
        fullName: byId.get(userId)!.fullName,
        subunitId: subunit.id,
        subunitName: subunit.name,
        source: "sheet",
        evidence:
          how === "phone number"
            ? `On the ${sheet.unit} sheet as “${person.name}” (same phone number)`
            : `On the ${sheet.unit} sheet as “${person.name}”`,
      });
    }
  }

  // ---- 2. course enrolments -----------------------------------------------
  const primaryIds = new Map(primaryUnits.map((s) => [s.id, s]));
  const counts = new Map<string, Map<string, number>>();
  for (const e of input.enrollments) {
    if (!byId.has(e.userId) || !primaryIds.has(e.subunitId)) continue;
    const per = counts.get(e.userId) ?? new Map<string, number>();
    per.set(e.subunitId, (per.get(e.subunitId) ?? 0) + 1);
    counts.set(e.userId, per);
  }
  for (const [userId, per] of counts) {
    if (out.has(userId) || contested.has(userId)) continue;
    const ranked = [...per.entries()].sort((a, b) => b[1] - a[1]);
    // A tie between two units is not evidence for either.
    if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) continue;
    const [subunitId, n] = ranked[0];
    const subunit = primaryIds.get(subunitId)!;
    out.set(userId, {
      userId,
      fullName: byId.get(userId)!.fullName,
      subunitId,
      subunitName: subunit.name,
      source: "courses",
      evidence: `Still enrolled in ${n} ${subunit.name} course${n === 1 ? "" : "s"}`,
    });
  }

  return [...out.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}
