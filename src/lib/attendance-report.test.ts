import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  buildReport,
  formatReportText,
  formatReportDate,
  formatSubunitBreakdown,
  type ReportPerson,
  type SubunitBreakdownRow,
} from "./attendance-report";
import { parseAbsenteeReport, checkDeclaredCounts } from "./absentee-parse";
import type { AbsenceReason } from "./absence-reasons";

const fixture = (n: string) => readFileSync(join(__dirname, "__fixtures__", n), "utf8");

function peopleFromFixture(file: string, rollTotal: number): ReportPerson[] {
  const parsed = parseAbsenteeReport(fixture(file));
  const absent: ReportPerson[] = parsed.absentees.map((a, i) => ({
    userId: `a${i}`,
    fullName: a.name,
    subunitName: "Photography",
    status: "absent",
    absenceReason: a.reason,
    absenceNote: a.note,
  }));
  const present: ReportPerson[] = Array.from(
    { length: rollTotal - absent.length },
    (_, i) => ({
      userId: `p${i}`,
      fullName: `Present Member ${i}`,
      subunitName: "Photography",
      status: "present" as const,
      absenceReason: null,
      absenceNote: null,
    })
  );
  return [...absent, ...present];
}

const noSubunits: SubunitBreakdownRow[] = [];

describe("formatReportDate", () => {
  it("writes the date the way the team writes it", () => {
    expect(formatReportDate("2026-10-04")).toBe("4/10/2026");
    expect(formatReportDate("2026-10-07")).toBe("7/10/2026");
  });
});

describe("rebuilding the real Wednesday report from its own data", () => {
  const people = peopleFromFixture("wednesday-report.txt", 101);
  const report = buildReport({
    activityName: "Wednesday Bible Study",
    serviceDate: "2026-10-07",
    people,
    subunits: noSubunits,
  });

  it("reproduces the headline figures exactly", () => {
    expect(report.totalMembers).toBe(101);
    expect(report.present).toBe(49);
    expect(report.absent).toBe(52);
  });

  it("the categories sum to the absent total", () => {
    const summed = report.categories.reduce((n, c) => n + c.people.length, 0);
    expect(summed).toBe(report.absent);
  });

  it("round-trips: the generated message re-parses to the same people", () => {
    // The strongest check available. If generating and re-reading the report
    // loses or renames anybody, these two sets diverge.
    const text = formatReportText(report);
    const reparsed = parseAbsenteeReport(text);

    expect(reparsed.totalMembers).toBe(101);
    expect(reparsed.declaredPresent).toBe(49);
    expect(reparsed.declaredAbsent).toBe(52);
    expect(reparsed.absentees).toHaveLength(52);
    expect(checkDeclaredCounts(reparsed)).toEqual([]);

    const original = new Set(
      people.filter((p) => p.status !== "present").map((p) => p.fullName)
    );
    const after = new Set(reparsed.absentees.map((a) => a.name));
    expect(after).toEqual(original);
  });

  it("round-trips the category each person sits under", () => {
    const text = formatReportText(report);
    const reparsed = parseAbsenteeReport(text);
    const byName = new Map(reparsed.absentees.map((a) => [a.name, a.reason]));
    for (const p of people.filter((x) => x.status !== "present")) {
      expect(byName.get(p.fullName), `${p.fullName} changed category`).toBe(p.absenceReason);
    }
  });

  it("round-trips the notes", () => {
    const text = formatReportText(report);
    const byName = new Map(parseAbsenteeReport(text).absentees.map((a) => [a.name, a.note]));
    expect(byName.get("Opara Chidumebi Elisheva")).toBe("wasn't feeling well");
    expect(byName.get("Ezedinachi Emmanuel Chidubem")).toBe("Catholic");
  });
});

describe("rebuilding the real Sunday report", () => {
  const people = peopleFromFixture("sunday-report.txt", 101);
  const report = buildReport({
    activityName: "Sunday Service",
    serviceDate: "2026-10-04",
    people,
    subunits: noSubunits,
  });

  it("reproduces the headline figures exactly", () => {
    expect(report.totalMembers).toBe(101);
    expect(report.present).toBe(58);
    expect(report.absent).toBe(43);
  });

  it("round-trips", () => {
    const reparsed = parseAbsenteeReport(formatReportText(report));
    expect(reparsed.absentees).toHaveLength(43);
    expect(checkDeclaredCounts(reparsed)).toEqual([]);
  });

  it("opens with the greeting and title the chat expects", () => {
    const text = formatReportText(report);
    expect(text.startsWith("Good evening Pastors and Leaders,")).toBe(true);
    expect(text).toContain("*MEDIA UNIT ATTENDANCE & ABSENTEE REPORT*");
    expect(text).toContain("*Sunday Service Report: 4/10/2026*");
  });
});

describe("statuses other than 'absent'", () => {
  const people: ReportPerson[] = [
    { userId: "1", fullName: "A One", subunitName: null, status: "present", absenceReason: null, absenceNote: null },
    { userId: "2", fullName: "B Two", subunitName: null, status: "traveled", absenceReason: "travelled", absenceNote: null },
    { userId: "3", fullName: "C Three", subunitName: null, status: "excused", absenceReason: "on_it", absenceNote: null },
  ];
  const r = buildReport({ activityName: "Sunday Service", serviceDate: "2026-10-04", people, subunits: [] });

  it("counts traveled and excused as absent, not present", () => {
    expect(r.present).toBe(1);
    expect(r.absent).toBe(2);
  });

  it("counts the On IT line", () => {
    expect(r.onIt).toBe(1);
  });
});

describe("an absence with no category recorded", () => {
  it("still appears, under Other Reasons, so the totals reconcile", () => {
    const people: ReportPerson[] = [
      { userId: "1", fullName: "Zed Unknown", subunitName: null, status: "absent", absenceReason: null, absenceNote: null },
      { userId: "2", fullName: "Present Person", subunitName: null, status: "present", absenceReason: null, absenceNote: null },
    ];
    const r = buildReport({ activityName: "Sunday Service", serviceDate: "2026-10-04", people, subunits: [] });
    expect(r.absent).toBe(1);
    const summed = r.categories.reduce((n, c) => n + c.people.length, 0);
    expect(summed).toBe(1);
    expect(r.categories[0].reason).toBe("other" as AbsenceReason);
  });
});

describe("subunit breakdown", () => {
  const subunits: SubunitBreakdownRow[] = [
    { subunitName: "Photography", total: 20, present: 15, absent: 5, submitted: true, late: false, noService: false },
    { subunitName: "Projection", total: 10, present: 4, absent: 6, submitted: true, late: true, noService: false },
    { subunitName: "Production", total: 8, present: 0, absent: 0, submitted: false, late: false, noService: false },
    { subunitName: "Social Media", total: 5, present: 0, absent: 0, submitted: false, late: false, noService: true },
  ];
  const r = buildReport({ activityName: "Sunday Service", serviceDate: "2026-10-04", people: [], subunits });

  it("names the subunits that owe a report, excluding no-service weeks", () => {
    expect(r.missingSubunits).toEqual(["Production"]);
  });

  it("flags a late submission and shows percentages", () => {
    const text = formatSubunitBreakdown(r);
    expect(text).toContain("Photography: 15/20 present (75%)");
    expect(text).toContain("Projection: 4/10 present (40%) — submitted late");
    expect(text).toContain("Production: NOT SUBMITTED");
    expect(text).toContain("Social Media: no service held");
  });
});
