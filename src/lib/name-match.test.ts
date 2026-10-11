import { describe, it, expect } from "vitest";
import { normalizeName, buildNameIndex, matchName, matchAll } from "./name-match";

const roster = buildNameIndex([
  { id: "1", fullName: "Opara Chidumebi Elisheva" },
  { id: "2", fullName: "Mameme Obinna God'swill" },
  { id: "3", fullName: "Austin-Nwaroh Ogechukwu Precious" },
  { id: "4", fullName: "Sunday Divine Edache" },
  { id: "5", fullName: "Sunday Chinemerem Emmanuel" },
  { id: "6", fullName: "Esther Emmanuel" },
  { id: "7", fullName: "Nwokolo Kamsiyochukwu Philip" },
]);

describe("normalizeName", () => {
  it("folds apostrophes into the word", () => {
    expect(normalizeName("God'swill")).toBe("godswill");
    expect(normalizeName("God’swill")).toBe("godswill");
  });

  it("splits hyphenated names into tokens", () => {
    expect(normalizeName("Austin-Nwaroh")).toBe("austin nwaroh");
  });

  it("strips the invisible characters WhatsApp leaves behind", () => {
    expect(normalizeName("⁠Ikeme Daniel")).toBe("ikeme daniel");
  });
});

describe("matchName", () => {
  it("matches an exact name", () => {
    const m = matchName("Opara Chidumebi Elisheva", roster);
    expect(m.kind).toBe("exact");
    expect(m.id).toBe("1");
  });

  it("matches regardless of the order the names are written in", () => {
    const m = matchName("Elisheva Opara Chidumebi", roster);
    expect(m.kind).toBe("same-tokens");
    expect(m.id).toBe("1");
  });

  it("matches through an apostrophe difference", () => {
    expect(matchName("Mameme Obinna Godswill", roster).id).toBe("2");
    expect(matchName("Mameme Obinna God’swill", roster).id).toBe("2");
  });

  it("matches a shortened form", () => {
    const m = matchName("Austin-Nwaroh Precious", roster);
    expect(m.kind).toBe("subset");
    expect(m.id).toBe("3");
  });

  it("refuses to guess between two people who share a name", () => {
    // "Sunday" is a given name here and belongs to two different members.
    const m = matchName("Sunday", roster);
    expect(m.kind).not.toBe("exact");
    expect(m.id).toBeNull();
  });

  it("will not identify somebody from a single token", () => {
    // Even though only one person is called Philip, one name is too thin a
    // basis for marking a person absent.
    const m = matchName("Philip", roster);
    expect(m.id).toBeNull();
  });

  it("resolves a two-token form that fits exactly one person", () => {
    // "Sunday Emmanuel" is a subset of "Sunday Chinemerem Emmanuel" and of
    // nobody else — Esther Emmanuel lacks "sunday", Sunday Divine Edache lacks
    // "emmanuel". Two tokens is enough here, so this should resolve.
    const m = matchName("Sunday Emmanuel", roster);
    expect(m.kind).toBe("subset");
    expect(m.id).toBe("5");
  });

  it("returns ambiguous, with the options, when two people genuinely collide", () => {
    const twins = buildNameIndex([
      { id: "a", fullName: "Chukwu Emeka Daniel" },
      { id: "b", fullName: "Daniel Emeka Chukwu" },
    ]);
    const m = matchName("Emeka Chukwu Daniel", twins);
    expect(m.kind).toBe("ambiguous");
    expect(m.id).toBeNull();
    expect(m.options.map((o) => o.id).sort()).toEqual(["a", "b"]);
  });

  it("returns none for somebody not on the roster", () => {
    expect(matchName("Chinedu Okonkwo", roster).kind).toBe("none");
  });

  it("returns none for an empty string", () => {
    expect(matchName("   ", roster).kind).toBe("none");
  });
});

describe("matchAll", () => {
  it("never assigns one person to two written names", () => {
    // Both spellings point at member 1. Taking both would quietly drop an
    // absentee and leave them recorded as present.
    const out = matchAll(
      [{ name: "Opara Chidumebi Elisheva" }, { name: "Elisheva Opara Chidumebi" }],
      roster
    );
    expect(out[0].match.id).toBe("1");
    expect(out[1].match.id).toBeNull();
    expect(out[1].match.kind).toBe("ambiguous");
  });

  it("passes through unrelated names untouched", () => {
    const out = matchAll([{ name: "Esther Emmanuel" }, { name: "Nobody Here" }], roster);
    expect(out[0].match.id).toBe("6");
    expect(out[1].match.kind).toBe("none");
  });
});
