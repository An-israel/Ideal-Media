import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseMemberList, looksLikeNigerianMobile, normalizeMemberName } from "./member-list";

const LIST = readFileSync(join(__dirname, "__fixtures__", "member-list.txt"), "utf8");

// This fixture is the real media members list, unedited. Every quirk tested
// below is one the actual list has, and each one would cut off a real person
// if it were mishandled.
describe("the real media members list", () => {
  const r = parseMemberList(LIST);

  it("reads every numbered entry", () => {
    expect(r.members).toHaveLength(101);
    expect(r.unreadable).toEqual([]);
  });

  it("keeps hyphenated surnames whole", () => {
    // Splitting on the first hyphen would turn these into "Austin" and
    // "Aja-Aki" into "Aja", matching the wrong person or nobody.
    const names = r.members.map((m) => m.name);
    expect(names).toContain("Austin-Nwaroh Ogechukwu Precious");
    expect(names).toContain("Aja-Aki Chioma Nwannediya");
    expect(names).toContain("David-Onuoha Mmesoma Milagro");
  });

  it("keeps an apostrophe in a name", () => {
    expect(r.members.map((m) => m.name)).toContain("Mameme Obinna God'swill");
  });

  it("handles numbering with no space after the dot", () => {
    // Line 59 is written "59.Godwin Favour".
    const godwin = r.members.find((m) => m.position === 59);
    expect(godwin?.name).toBe("Godwin Favour");
  });

  it("reads a trailing hyphen as a missing phone, not part of the name", () => {
    const last = r.members.find((m) => m.position === 101);
    expect(last?.name).toBe("Ezechi Chinwe");
    expect(last?.phone).toBeNull();
  });

  it("finds exactly the eight entries with no phone number", () => {
    expect(r.withoutPhone.map((m) => m.position).sort((a, b) => a - b)).toEqual([
      46, 54, 56, 59, 60, 71, 75, 101,
    ]);
  });

  it("flags the one phone number that isn't a Nigerian mobile", () => {
    expect(r.suspectPhones).toHaveLength(1);
    expect(r.suspectPhones[0].position).toBe(13);
    expect(r.suspectPhones[0].phone).toBe("1806973270");
  });

  it("refuses to use a suspect number as a matching key", () => {
    // Matching on a wrong number is worse than not matching: it can bind the
    // entry to somebody else entirely.
    expect(r.members.find((m) => m.position === 13)?.phoneKey).toBeNull();
  });

  it("spots the Owan Flourish duplicate", () => {
    expect(r.possibleDuplicates).toHaveLength(1);
    const [{ a, b }] = r.possibleDuplicates;
    expect([a.position, b.position].sort((x, y) => x - y)).toEqual([38, 54]);
  });

  it("reads the international numbers correctly", () => {
    const perfection = r.members.find((m) => m.position === 80);
    expect(perfection?.phone).toBe("2348123320439");
    expect(perfection?.phoneKey).not.toBeNull();
    const bethel = r.members.find((m) => m.position === 88);
    expect(bethel?.phoneKey).not.toBeNull();
  });

  it("gives every member with a plausible number a distinct matching key", () => {
    const keys = r.members.map((m) => m.phoneKey).filter(Boolean) as string[];
    expect(new Set(keys).size, "two entries share a phone number").toBe(keys.length);
  });

  it("every entry has a usable name", () => {
    for (const m of r.members) {
      expect(normalizeMemberName(m.name).length, `#${m.position} has no name`).toBeGreaterThan(0);
    }
  });
});

describe("looksLikeNigerianMobile", () => {
  it("accepts the forms the list actually uses", () => {
    expect(looksLikeNigerianMobile("9022035639")).toBe(true); // 10 digits, no trunk 0
    expect(looksLikeNigerianMobile("09022035639")).toBe(true); // with trunk 0
    expect(looksLikeNigerianMobile("2348123320439")).toBe(true); // country code
  });

  it("rejects what cannot be a mobile", () => {
    expect(looksLikeNigerianMobile("1806973270")).toBe(false); // the #13 typo
    expect(looksLikeNigerianMobile("123")).toBe(false);
    expect(looksLikeNigerianMobile("")).toBe(false);
    expect(looksLikeNigerianMobile("60283236")).toBe(false); // too short
  });
});

describe("parsing oddities", () => {
  it("reports a line it cannot read rather than dropping it", () => {
    const r = parseMemberList("1. Real Person - 8012345678\nnot a numbered line\n3. Another - 8012345679");
    expect(r.members).toHaveLength(2);
    expect(r.unreadable).toEqual([{ line: 2, text: "not a numbered line" }]);
  });

  it("does not treat a hyphen inside a name as a phone separator", () => {
    const r = parseMemberList("1. Austin-Nwaroh Precious");
    expect(r.members[0].name).toBe("Austin-Nwaroh Precious");
    expect(r.members[0].phone).toBeNull();
  });

  it("strips the invisible characters a paste can carry", () => {
    const r = parseMemberList("1.⁠ Chidi Okeke - 8012345678");
    expect(r.members[0].name).toBe("Chidi Okeke");
  });
});

describe("the unit-list formats", () => {
  // The subunit sheets separate the number with a tab or spaces rather than a
  // dash, and sometimes write it out in groups.
  const cases: [string, string, string | null][] = [
    ["1. Nwokolo Kamsiyochukwu Philip\t09034420395", "Nwokolo Kamsiyochukwu Philip", "09034420395"],
    ["2. Madukasi Godswill\t07069449149", "Madukasi Godswill", "07069449149"],
    ["17. Moses +234 704 111 8511", "Moses", "2347041118511"],
    ["18. Charles 810 111 5730", "Charles", "8101115730"],
    ["5. Christian Okonkwo\t901 153 2264", "Christian Okonkwo", "9011532264"],
    ["8. Emmanuel\t 0703 7526787", "Emmanuel", "07037526787"],
    ["8. OGBONNA Precious C.\t8155113431", "OGBONNA Precious C.", "8155113431"],
    ["4. Kalu Victoria", "Kalu Victoria", null],
    ["5. Uche", "Uche", null],
    ["12. God's Child Precious Munachiso", "God's Child Precious Munachiso", null],
    ["31. Aja-aki Chioma", "Aja-aki Chioma", null],
  ];

  it.each(cases)("reads %j", (line, name, phone) => {
    const r = parseMemberList(line as string);
    expect(r.members).toHaveLength(1);
    expect(r.members[0].name).toBe(name);
    expect(r.members[0].phone).toBe(phone);
  });

  it("still reads the dash-separated master format", () => {
    const r = parseMemberList("1.  Agbo Amarachi Emmanuella - 9022035639");
    expect(r.members[0].name).toBe("Agbo Amarachi Emmanuella");
    expect(r.members[0].phone).toBe("9022035639");
  });

  it("does not eat a hyphenated surname that has no number", () => {
    const r = parseMemberList("100. Austin-Nwaroh Ogechukwu Precious");
    expect(r.members[0].name).toBe("Austin-Nwaroh Ogechukwu Precious");
  });

  it("keeps a hyphenated surname when a number follows", () => {
    const r = parseMemberList("95. David-Onuoha Mmesoma Milagro 9060694909");
    expect(r.members[0].name).toBe("David-Onuoha Mmesoma Milagro");
    expect(r.members[0].phone).toBe("9060694909");
  });
});
