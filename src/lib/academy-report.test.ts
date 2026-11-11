import { describe, it, expect } from "vitest";
import { buildAcademyReport, type ReportInput } from "./academy-report";

const base = (): ReportInput => ({
  courses: [
    { id: "gd", slug: "graphic-design", title: "Graphic Design", position: 1 },
    { id: "ve", slug: "video-editing", title: "Video Editing", position: 2 },
  ],
  steps: [
    { id: "gd1", courseId: "gd" },
    { id: "gd2", courseId: "gd" },
    { id: "gd-a", courseId: "gd" },
    { id: "ve1", courseId: "ve" },
  ],
  done: [],
  certificates: [],
  members: [
    { id: "ada", fullName: "Ada" },
    { id: "ben", fullName: "Ben" },
    { id: "cy", fullName: "Cy" },
  ],
});

describe("buildAcademyReport", () => {
  it("counts started, finished and certificates per course", () => {
    const input = base();
    input.done = [
      { userId: "ada", stepId: "gd1", at: "2026-11-01" },
      { userId: "ada", stepId: "gd2", at: "2026-11-02" },
      { userId: "ada", stepId: "gd-a", at: "2026-11-03" },
      { userId: "ben", stepId: "gd1", at: "2026-11-04" },
    ];
    input.certificates = [{ userId: "ada", courseId: "gd", code: "ILC-AAAA-BBBB", issuedAt: "2026-11-03" }];
    const r = buildAcademyReport(input);

    const gd = r.courses.find((c) => c.id === "gd")!;
    expect(gd).toMatchObject({ steps: 3, started: 2, finished: 1, certificates: 1 });
    expect(r.courses.find((c) => c.id === "ve")).toMatchObject({ started: 0, finished: 0 });
    expect(r.totals).toEqual({ members: 3, learning: 2, finishedCourses: 1, certificates: 1 });
  });

  it("does not count an assignment-less run of lessons as finished", () => {
    // Every lesson ticked but the assignment not submitted is not finished —
    // the same rule the course page and the certificate use.
    const input = base();
    input.done = [
      { userId: "ada", stepId: "gd1", at: "2026-11-01" },
      { userId: "ada", stepId: "gd2", at: "2026-11-02" },
    ];
    const r = buildAcademyReport(input);
    expect(r.courses.find((c) => c.id === "gd")!.finished).toBe(0);
    expect(r.members[0].courses[0]).toMatchObject({ done: 2, total: 3, percent: 67, finished: false });
  });

  it("counts a step recorded twice only once", () => {
    const input = base();
    input.done = [
      { userId: "ada", stepId: "ve1", at: "2026-11-01" },
      { userId: "ada", stepId: "ve1", at: "2026-11-02" },
    ];
    const r = buildAcademyReport(input);
    expect(r.members[0].courses[0]).toMatchObject({ done: 1, total: 1, percent: 100 });
  });

  it("ignores anyone outside the report's members — a leader's scope", () => {
    const input = base();
    input.members = [{ id: "ada", fullName: "Ada" }];
    input.done = [
      { userId: "ada", stepId: "gd1", at: "2026-11-01" },
      { userId: "outsider", stepId: "gd1", at: "2026-11-02" },
    ];
    input.certificates = [{ userId: "outsider", courseId: "gd", code: "ILC-X", issuedAt: "x" }];
    const r = buildAcademyReport(input);
    expect(r.members.map((m) => m.id)).toEqual(["ada"]);
    expect(r.courses.find((c) => c.id === "gd")!.started).toBe(1);
    expect(r.totals.certificates).toBe(0);
  });

  it("lists who has not started, and orders the rest by last activity", () => {
    const input = base();
    input.done = [
      { userId: "ada", stepId: "gd1", at: "2026-11-01" },
      { userId: "ben", stepId: "gd1", at: "2026-11-09" },
    ];
    const r = buildAcademyReport(input);
    expect(r.members.map((m) => m.id)).toEqual(["ben", "ada"]);
    expect(r.notStarted.map((m) => m.id)).toEqual(["cy"]);
  });

  it("drops progress on a course that is no longer published", () => {
    const input = base();
    input.steps.push({ id: "old1", courseId: "retired" });
    input.done = [{ userId: "ada", stepId: "old1", at: "2026-11-01" }];
    const r = buildAcademyReport(input);
    expect(r.members).toEqual([]);
    expect(r.notStarted).toHaveLength(3);
  });
});
