import { describe, it, expect } from "vitest";
import { suggestSubunits, type SuggestAccount, type SuggestSubunit } from "./subunit-suggestions";
import type { SheetData } from "./roster-restore";

const subunits: SuggestSubunit[] = [
  { id: "prod", name: "Production", slug: "production", category: "primary" },
  { id: "photo", name: "Photography", slug: "photography", category: "primary" },
  { id: "tech", name: "Utility (Videography & Technical)", slug: "utility", category: "primary" },
  { id: "vid", name: "Video Editing", slug: "video-editing", category: "secondary" },
];

const acct = (id: string, fullName: string, phone: string | null = null): SuggestAccount => ({
  id,
  fullName,
  phone,
  whatsappNumber: null,
});

const sheets = (over: Partial<SheetData> = {}): SheetData => ({
  officialList: [],
  aliases: [],
  sheets: [
    {
      unit: "Production",
      membership: "primary",
      members: [
        { name: "Ohiero Favour", phone: "08084816728" },
        { name: "Abugu Philip", phone: null },
      ],
    },
    { unit: "Photography", membership: "primary", members: [{ name: "Christian Okonkwo", phone: null }] },
    { unit: "Technical", membership: "primary", members: [{ name: "Michelle", phone: "09049291694" }] },
    { unit: "Video Editing", membership: "secondary", members: [{ name: "Chinenye", phone: null }] },
  ],
  ...over,
});

describe("suggestSubunits", () => {
  it("places a member named on a primary sheet in that unit", () => {
    const got = suggestSubunits({
      unassigned: [acct("a", "Abugu Philip")],
      subunits,
      sheets: sheets(),
      enrollments: [],
    });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ userId: "a", subunitId: "prod", source: "sheet" });
    expect(got[0].evidence).toContain("Production sheet");
  });

  it("recognises a sheet entry by phone number when the name is only a first name", () => {
    // "Michelle" alone could never be matched on a name; the number is what
    // identifies her, and the evidence says so.
    const got = suggestSubunits({
      unassigned: [acct("m", "Michelle Okafor", "+2349049291694")],
      subunits,
      sheets: sheets(),
      enrollments: [],
    });
    expect(got[0]).toMatchObject({ userId: "m", subunitId: "tech" });
    expect(got[0].evidence).toContain("same phone number");
  });

  it("finds the Technical unit while it still carries its old name and slug", () => {
    const got = suggestSubunits({
      unassigned: [acct("m", "Somebody", "09049291694")],
      subunits,
      sheets: sheets(),
      enrollments: [],
    });
    expect(got[0].subunitName).toBe("Utility (Videography & Technical)");
  });

  it("matches the same words in a different order", () => {
    const got = suggestSubunits({
      unassigned: [acct("f", "Favour Ohiero")],
      subunits,
      sheets: sheets(),
      enrollments: [],
    });
    expect(got[0]).toMatchObject({ userId: "f", subunitId: "prod" });
  });

  it("never suggests a unit from a secondary sheet", () => {
    // Being on the Video Editing sheet says they also do video editing, not
    // that Video Editing takes their attendance.
    const got = suggestSubunits({
      unassigned: [acct("c", "Chinenye")],
      subunits,
      sheets: sheets(),
      enrollments: [],
    });
    expect(got).toEqual([]);
  });

  it("suggests nothing for a member two sheets both claim", () => {
    const data = sheets();
    data.sheets[1].members.push({ name: "Abugu Philip", phone: null });
    const got = suggestSubunits({
      unassigned: [acct("a", "Abugu Philip")],
      subunits,
      sheets: data,
      enrollments: [{ userId: "a", subunitId: "prod" }],
    });
    // Not even the course evidence: the sheets disagree, so a person decides.
    expect(got).toEqual([]);
  });

  it("falls back to course enrolments for somebody on no sheet", () => {
    const got = suggestSubunits({
      unassigned: [acct("x", "Restored Member")],
      subunits,
      sheets: sheets(),
      enrollments: [
        { userId: "x", subunitId: "photo" },
        { userId: "x", subunitId: "photo" },
        { userId: "x", subunitId: "prod" },
      ],
    });
    expect(got[0]).toMatchObject({ userId: "x", subunitId: "photo", source: "courses" });
    expect(got[0].evidence).toBe("Still enrolled in 2 Photography courses");
  });

  it("does not guess between two units with the same number of enrolments", () => {
    const got = suggestSubunits({
      unassigned: [acct("x", "Restored Member")],
      subunits,
      sheets: sheets(),
      enrollments: [
        { userId: "x", subunitId: "photo" },
        { userId: "x", subunitId: "prod" },
      ],
    });
    expect(got).toEqual([]);
  });

  it("ignores enrolments in a secondary unit's courses", () => {
    const got = suggestSubunits({
      unassigned: [acct("x", "Restored Member")],
      subunits,
      sheets: sheets(),
      enrollments: [{ userId: "x", subunitId: "vid" }],
    });
    expect(got).toEqual([]);
  });

  it("prefers the sheet over the courses when both exist", () => {
    const got = suggestSubunits({
      unassigned: [acct("a", "Abugu Philip")],
      subunits,
      sheets: sheets(),
      enrollments: [
        { userId: "a", subunitId: "photo" },
        { userId: "a", subunitId: "photo" },
      ],
    });
    expect(got[0]).toMatchObject({ subunitId: "prod", source: "sheet" });
  });

  it("uses a confirmed spelling pair", () => {
    const got = suggestSubunits({
      unassigned: [acct("k", "Chika Chukwuelokalum Benedict")],
      subunits,
      sheets: sheets({
        aliases: [{ sheet: "kelvin", official: "Chika Chukwuelokalum Benedict" }],
        sheets: [{ unit: "Technical", membership: "primary", members: [{ name: "kelvin", phone: null }] }],
      }),
      enrollments: [],
    });
    expect(got[0]).toMatchObject({ userId: "k", subunitId: "tech" });
  });

  it("only ever suggests for the members it was given", () => {
    const got = suggestSubunits({
      unassigned: [],
      subunits,
      sheets: sheets(),
      enrollments: [{ userId: "someone-else", subunitId: "photo" }],
    });
    expect(got).toEqual([]);
  });
});
