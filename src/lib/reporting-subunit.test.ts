import { describe, it, expect } from "vitest";
import {
  resolveReportingSubunit,
  resolveReportingSubunits,
  type MembershipRow,
} from "./reporting-subunit";

const primary = (subunitId: string, leader = false): MembershipRow => ({
  subunitId,
  membershipType: "primary",
  roleInSubunit: leader ? "leader" : "member",
});
const secondary = (subunitId: string, leader = false): MembershipRow => ({
  subunitId,
  membershipType: "secondary",
  roleInSubunit: leader ? "leader" : "member",
});

describe("resolveReportingSubunit", () => {
  it("uses the primary subunit", () => {
    expect(resolveReportingSubunit([primary("photo"), secondary("graphics")])).toBe("photo");
  });

  it("puts a leader on the list they lead when they have no primary", () => {
    // The bug this fixes: promoting someone to lead a subunit they weren't in
    // adds them as a SECONDARY member, so they were missing from the very list
    // they had to fill in.
    expect(resolveReportingSubunit([secondary("photo", true)])).toBe("photo");
  });

  it("keeps a leader on their own primary subunit, not the one they lead", () => {
    // The double-count trap. This person is primary in Projection and leads
    // Photography; they must appear once, under Projection.
    const rows = [primary("projection"), secondary("photo", true)];
    expect(resolveReportingSubunit(rows)).toBe("projection");
  });

  it("is unchanged when the leader IS a primary member of what they lead", () => {
    expect(resolveReportingSubunit([primary("photo", true)])).toBe("photo");
  });

  it("picks the same subunit every time for someone leading two", () => {
    const rows = [secondary("zeta", true), secondary("alpha", true)];
    expect(resolveReportingSubunit(rows)).toBe("alpha");
    // Order of the input must not change the answer, or a person would move
    // between lists between page loads.
    expect(resolveReportingSubunit([...rows].reverse())).toBe("alpha");
  });

  it("returns null for a plain secondary member with no primary", () => {
    expect(resolveReportingSubunit([secondary("graphics")])).toBeNull();
  });

  it("returns null when there are no memberships at all", () => {
    expect(resolveReportingSubunit([])).toBeNull();
  });
});

describe("resolveReportingSubunits — the invariant", () => {
  it("assigns every resolvable person to exactly one subunit", () => {
    const rows = [
      { userId: "a", ...primary("photo") },
      { userId: "a", ...secondary("graphics") },
      { userId: "b", ...secondary("photo", true) },
      { userId: "c", ...primary("projection") },
      { userId: "c", ...secondary("photo", true) },
      { userId: "d", ...secondary("graphics") },
    ];
    const map = resolveReportingSubunits(rows);

    expect(map.get("a")).toBe("photo");
    expect(map.get("b")).toBe("photo");
    expect(map.get("c")).toBe("projection");
    expect(map.has("d")).toBe(false);

    // Nobody can be counted twice: one entry per user, by construction.
    expect(map.size).toBe(3);
  });

  it("never lets the subunit totals exceed the number of people", () => {
    const rows = [
      { userId: "a", ...primary("photo") },
      { userId: "a", ...secondary("projection", true) },
      { userId: "b", ...secondary("photo", true) },
      { userId: "b", ...secondary("projection", true) },
    ];
    const map = resolveReportingSubunits(rows);
    const perSubunit = new Map<string, number>();
    for (const s of map.values()) perSubunit.set(s, (perSubunit.get(s) ?? 0) + 1);
    const total = [...perSubunit.values()].reduce((n, v) => n + v, 0);
    expect(total).toBe(2);
  });
});
