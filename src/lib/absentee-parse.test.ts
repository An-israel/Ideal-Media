import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseAbsenteeReport, checkDeclaredCounts } from "./absentee-parse";
import { matchReason } from "./absence-reasons";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__", name), "utf8");

const WEDNESDAY = fixture("wednesday-report.txt");
const SUNDAY = fixture("sunday-report.txt");

// These two files are real reports, pasted out of WhatsApp unedited — bold
// markers, doubled bullets, and invisible word-joiner characters included. If
// the parser only works on tidied-up input it is useless.
describe("the real Wednesday report", () => {
  const r = parseAbsenteeReport(WEDNESDAY);

  it("reads the header counts", () => {
    expect(r.totalMembers).toBe(101);
    expect(r.declaredPresent).toBe(49);
    expect(r.declaredAbsent).toBe(52);
  });

  it("finds all 52 absentees", () => {
    expect(r.absentees).toHaveLength(52);
  });

  it("files each one under the right heading", () => {
    const count = (reason: string) =>
      r.absentees.filter((a) => a.reason === reason).length;
    expect(count("illness")).toBe(3);
    expect(count("travelled")).toBe(4);
    expect(count("academic")).toBe(5);
    expect(count("unreachable")).toBe(9);
    expect(count("not_responding")).toBe(12);
    expect(count("no_valid_reason")).toBe(2);
    expect(count("other")).toBe(4);
    expect(count("withdrawn")).toBe(8);
    expect(count("inconsistent")).toBe(5);
  });

  it("agrees with every count the report declared", () => {
    expect(checkDeclaredCounts(r)).toEqual([]);
  });

  it("strips doubled bullets and invisible characters from names", () => {
    // Written as "* ⁠- Daniel Chukwuka Obi" with a word joiner between the
    // bullets. A naive split leaves "- Daniel" or "⁠Daniel", neither of which
    // matches a roster name.
    const names = r.absentees.map((a) => a.name);
    expect(names).toContain("Daniel Chukwuka Obi");
    expect(names).toContain("Okereke Nzubechukwu Goodness");
    expect(names).toContain("Ezeamatu Chigozirim Gift");
    expect(names).toContain("Austin-Nwaroh Ogechukwu Precious");
    expect(names).toContain("Ikeme Ebubechukwu Daniel");
    for (const n of names) {
      expect(n, `"${n}" still has a leading bullet`).not.toMatch(/^[-*•·]/);
      expect(n, `"${n}" still has an invisible char`).not.toMatch(
        /[ ​⁠﻿]/
      );
    }
  });

  it("keeps the note that follows the name", () => {
    const opara = r.absentees.find((a) => a.name === "Opara Chidumebi Elisheva");
    expect(opara?.note).toBe("wasn't feeling well");
    const sunday = r.absentees.find((a) => a.name === "Sunday Divine Edache");
    expect(sunday?.note).toContain("travels often");
  });

  it("leaves the note empty when the line is just a name", () => {
    const esther = r.absentees.find((a) => a.name === "Esther Emmanuel");
    expect(esther?.reason).toBe("not_responding");
    expect(esther?.note).toBeNull();
  });

  it("handles a heading with no colon (INCONSISTENT 5)", () => {
    const names = r.absentees.filter((a) => a.reason === "inconsistent").map((a) => a.name);
    expect(names).toContain("Jennifer Joseph");
    expect(names).toHaveLength(5);
  });

  it("drops nothing on the floor", () => {
    expect(r.orphanLines).toEqual([]);
    expect(r.unknownHeadings).toEqual([]);
  });

  it("does not mistake the 'On IT: 7' header count for a person", () => {
    expect(r.absentees.map((a) => a.name)).not.toContain("On IT");
    expect(r.absentees.every((a) => !/^\d+$/.test(a.name))).toBe(true);
  });
});

describe("the real Sunday report", () => {
  const r = parseAbsenteeReport(SUNDAY);

  it("reads the header counts", () => {
    expect(r.totalMembers).toBe(101);
    expect(r.declaredPresent).toBe(58);
    expect(r.declaredAbsent).toBe(43);
  });

  it("finds all 43 absentees", () => {
    expect(r.absentees).toHaveLength(43);
  });

  it("recognises 'Withdrew / Opted Out' as the withdrawn category", () => {
    const names = r.absentees.filter((a) => a.reason === "withdrawn").map((a) => a.name);
    expect(names).toHaveLength(5);
    expect(names).toContain("Chisom Precious");
  });

  it("agrees with every count the report declared", () => {
    expect(checkDeclaredCounts(r)).toEqual([]);
  });

  it("does not treat the 'Withdrawn: 5' header line as a category of names", () => {
    // It appears in the summary block ABOVE the categorization, where it is a
    // count. The five names come from the real heading further down.
    expect(r.orphanLines).toEqual([]);
  });

  it("present + absent equals the roll", () => {
    expect((r.declaredPresent ?? 0) + (r.declaredAbsent ?? 0)).toBe(r.totalMembers);
  });
});

describe("heading matching", () => {
  it("survives the wording drifting between weeks", () => {
    expect(matchReason("*Absent Due to Illness: 3*")).toBe("illness");
    expect(matchReason("ILLNESS 7")).toBe("illness");
    expect(matchReason("Withdrawn: 8")).toBe("withdrawn");
    expect(matchReason("Withdrew / Opted Out: 5")).toBe("withdrawn");
    expect(matchReason("INCONSISTENT 5")).toBe("inconsistent");
    expect(matchReason("Academic/School Engagements: 2")).toBe("academic");
    expect(matchReason("On IT: 7")).toBe("on_it");
    expect(matchReason("Other Reasons: 4")).toBe("other");
  });

  it("returns null for something that isn't a category", () => {
    expect(matchReason("Good evening Pastors and Leaders")).toBeNull();
    expect(matchReason("")).toBeNull();
  });
});

describe("counts that don't add up", () => {
  it("reports the mismatch rather than hiding it", () => {
    const r = parseAbsenteeReport(
      ["*Absentee Categorization (3 Total):*", "* *Travelled: 3*", "- A", "- B"].join("\n")
    );
    expect(r.absentees).toHaveLength(2);
    expect(checkDeclaredCounts(r)).toEqual([
      { reason: "travelled", heading: "Travelled: 3", declared: 3, found: 2 },
    ]);
  });
});

describe("a name listed twice", () => {
  it("keeps the first heading it appeared under", () => {
    const r = parseAbsenteeReport(
      [
        "*Absentee Categorization (2 Total):*",
        "* *Travelled: 1*",
        "- Chidi Okeke: in Lagos",
        "* *Unreachable: 1*",
        "- Chidi Okeke",
      ].join("\n")
    );
    expect(r.absentees).toHaveLength(1);
    expect(r.absentees[0].reason).toBe("travelled");
    expect(r.absentees[0].note).toBe("in Lagos");
  });
});
