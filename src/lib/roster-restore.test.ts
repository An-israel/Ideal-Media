import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collectPeople, findRosterGap, type AccountLike, type SheetData } from "./roster-restore";

const sheets = JSON.parse(
  readFileSync(join(process.cwd(), "src/data/member-sheets.json"), "utf8")
) as SheetData;

const account = (id: string, fullName: string, phone: string | null = null): AccountLike => ({
  id,
  fullName,
  phone,
  whatsappNumber: null,
});

describe("the member sheets that ship with the app", () => {
  it("matches the SQL scripts they were taken from", () => {
    expect(sheets.officialList).toHaveLength(101);
    expect(sheets.sheets.map((s) => `${s.unit}:${s.members.length}`)).toEqual([
      "Production:20",
      "Photography:21",
      "Projection:27",
      "Video Editing:24",
      "Social Media:19",
      "Technical:29",
    ]);
  });

  it("does not list Nwachukwu Chibueze under Social Media", () => {
    // The department settled that Technical counts him, so he came off the
    // other sheet. If he reappeared there, the two would fight over him again.
    const social = sheets.sheets.find((s) => s.unit === "Social Media")!;
    expect(social.members.map((m) => m.name)).not.toContain("Nwachukwu Chibueze");
    const technical = sheets.sheets.find((s) => s.unit === "Technical")!;
    expect(technical.members.map((m) => m.name)).toContain("Chibueze nwachukwu");
  });
});

describe("collectPeople", () => {
  it("merges one person who is on several lists", () => {
    const people = collectPeople({
      officialList: [{ name: "Agu Chibueze Alex", phone: "8136821764" }],
      sheets: [
        { unit: "Production", membership: "primary", members: [{ name: "Agu Chibueze Alex", phone: "08136821764" }] },
        { unit: "Video Editing", membership: "secondary", members: [{ name: "Agu Chibueze", phone: null }] },
      ],
      aliases: [],
    });
    // Same number written two ways, plus a shortened name on a third list:
    // still one person, named by all three.
    expect(people).toHaveLength(1);
    expect([...people[0].sources].sort()).toEqual([
      "Members list",
      "Production",
      "Video Editing",
    ]);
    expect(people[0].phone).toBeTruthy();
  });

  it("uses a confirmed spelling pair to merge rather than duplicate", () => {
    const people = collectPeople({
      officialList: [{ name: "Chika Chukwuelokalum Benedict", phone: "7088980666" }],
      sheets: [
        { unit: "Technical", membership: "primary", members: [{ name: "kelvin", phone: "07088980666" }] },
      ],
      aliases: [{ sheet: "kelvin", official: "Chika Chukwuelokalum Benedict" }],
    });
    expect(people).toHaveLength(1);
    expect([...people[0].sources].sort()).toEqual(["Members list", "Technical"]);
  });

  it("treats the same words in a different order as one person", () => {
    // Production writes "Ohiero Favour", Video Editing writes "Favour ohiero".
    const people = collectPeople({
      officialList: [],
      sheets: [
        { unit: "Production", membership: "primary", members: [{ name: "Ohiero Favour", phone: "08084816728" }] },
        { unit: "Video Editing", membership: "secondary", members: [{ name: "Favour ohiero", phone: null }] },
      ],
      aliases: [],
    });
    expect(people).toHaveLength(1);
    expect([...people[0].sources].sort()).toEqual(["Production", "Video Editing"]);
  });

  it("joins a shortened spelling to the fuller one on another list", () => {
    // Neither carries a number and the names differ, so nothing but the words
    // says these are one person — and they are.
    const people = collectPeople({
      officialList: [{ name: "Eze Miracle Oluchi", phone: null }],
      sheets: [
        { unit: "Video Editing", membership: "secondary", members: [{ name: "Eze Oluchi", phone: null }] },
      ],
      aliases: [],
    });
    expect(people).toHaveLength(1);
    expect(people[0].name).toBe("Eze Miracle Oluchi");
  });

  it("refuses to join a shortened name that fits two people", () => {
    const people = collectPeople({
      officialList: [
        { name: "Agbo Amarachi Grace", phone: null },
        { name: "Agbo Amarachi Emmanuella", phone: null },
      ],
      sheets: [
        { unit: "Production", membership: "primary", members: [{ name: "Agbo Amarachi", phone: null }] },
      ],
      aliases: [],
    });
    expect(people).toHaveLength(3);
  });

  it("keeps two people apart when their phone numbers differ", () => {
    // Names that look like a shortening, but two different numbers are two
    // different people whatever the words say.
    const people = collectPeople({
      officialList: [{ name: "Sunday Chinemerem Emmanuel", phone: "08106313516" }],
      sheets: [
        { unit: "Photography", membership: "primary", members: [{ name: "Sunday Emmanuel", phone: "09112424977" }] },
      ],
      aliases: [],
    });
    expect(people).toHaveLength(2);
  });

  it("keeps a phone number that only one of the lists carries", () => {
    const people = collectPeople({
      officialList: [{ name: "Igattah Victor", phone: null }],
      sheets: [
        { unit: "Technical", membership: "primary", members: [{ name: "Igattah Victor", phone: "09130254153" }] },
      ],
      aliases: [],
    });
    expect(people).toHaveLength(1);
    expect(people[0].phone).toBe("09130254153");
  });
});

describe("findRosterGap", () => {
  const data: SheetData = {
    officialList: [
      { name: "Agu Chibueze Alex", phone: "8136821764" },
      { name: "Nobody Here", phone: "08000000001" },
    ],
    sheets: [
      {
        unit: "Technical",
        membership: "primary",
        members: [
          { name: "Michelle", phone: "09049291694" },
          { name: "Onyinye", phone: null },
        ],
      },
    ],
    aliases: [],
  };

  it("names only the people with no account", () => {
    const gap = findRosterGap(data, [account("a", "Agu Chibueze Alex", "08136821764")]);
    expect(gap.missing.map((m) => m.name)).toEqual(["Michelle", "Nobody Here", "Onyinye"]);
    expect(gap.present).toBe(1);
  });

  it("recognises somebody by phone number even when the name differs", () => {
    const gap = findRosterGap(data, [
      account("a", "Agu Chibueze Alex", "08136821764"),
      account("b", "Michelle Something Entirely Else", "+2349049291694"),
    ]);
    expect(gap.missing.map((m) => m.name)).toEqual(["Nobody Here", "Onyinye"]);
  });

  it("recognises a shortened name against a fuller one", () => {
    const gap = findRosterGap(
      { officialList: [{ name: "Majesty Gift", phone: null }], sheets: [], aliases: [] },
      [account("a", "Majesty Gift Chijindu")]
    );
    expect(gap.missing).toEqual([]);
  });

  it("treats an ambiguous name as already here rather than creating another", () => {
    // Two accounts fit, so one of them IS this person. Creating a third is the
    // duplicate this whole check exists to prevent.
    const gap = findRosterGap(
      { officialList: [{ name: "Agbo Amarachi", phone: null }], sheets: [], aliases: [] },
      [account("a", "Agbo Amarachi Grace"), account("b", "Agbo Amarachi Emmanuella")]
    );
    expect(gap.missing).toEqual([]);
  });

  it("does not let a one-word account absorb a two-word name", () => {
    // The hole that was fixed in the SQL too: "Chiamaka" is inside every name
    // that uses it, so it would silently claim Vera.
    const gap = findRosterGap(
      { officialList: [{ name: "Vera Chiamaka", phone: null }], sheets: [], aliases: [] },
      [account("a", "Chiamaka")]
    );
    expect(gap.missing.map((m) => m.name)).toEqual(["Vera Chiamaka"]);
  });

  it("says where each missing person was written down", () => {
    const gap = findRosterGap(data, []);
    const michelle = gap.missing.find((m) => m.name === "Michelle")!;
    expect(michelle.sources).toEqual(["Technical"]);
    expect(michelle.phone).toBe("09049291694");
  });

  it("finds nobody missing once every account exists", () => {
    const gap = findRosterGap(data, [
      account("a", "Agu Chibueze Alex", "08136821764"),
      account("b", "Nobody Here", "08000000001"),
      account("c", "Michelle", "09049291694"),
      account("d", "Onyinye"),
    ]);
    expect(gap.missing).toEqual([]);
    expect(gap.present).toBe(gap.total);
  });
});

describe("the real lists against a site that has nobody", () => {
  it("would create one account per person, not one per list entry", () => {
    const gap = findRosterGap(sheets, []);
    const total = sheets.officialList.length + sheets.sheets.reduce((n, s) => n + s.members.length, 0);
    // 101 + 140 entries describe far fewer actual people.
    expect(total).toBe(241);
    expect(gap.total).toBeLessThan(total);
    expect(gap.missing).toHaveLength(gap.total);
    expect(new Set(gap.missing.map((m) => m.name)).size).toBe(gap.missing.length);
  });
});
