import { describe, it, expect } from "vitest";
import { toISODate, coerceISODate, parseBirthday, isoDaysAgo } from "./dates";

describe("toISODate", () => {
  it("uses local calendar components, not UTC", () => {
    // 1 Jan 2025 at 00:30 local. `toISOString().slice(0,10)` would report
    // 2024-12-31 on any server behind UTC — the bug this replaces (ATT-6).
    const d = new Date(2025, 0, 1, 0, 30);
    expect(toISODate(d)).toBe("2025-01-01");
  });

  it("pads single-digit months and days", () => {
    expect(toISODate(new Date(2025, 2, 5))).toBe("2025-03-05");
  });

  it("handles the last instant of a day without rolling over", () => {
    expect(toISODate(new Date(2025, 5, 30, 23, 59, 59))).toBe("2025-06-30");
  });
});

describe("coerceISODate", () => {
  it("passes an ISO date through", () => {
    expect(coerceISODate("2025-03-09")).toBe("2025-03-09");
  });

  it("reads a Date cell by its local components", () => {
    expect(coerceISODate(new Date(2025, 0, 1, 1, 0))).toBe("2025-01-01");
  });

  it("is day-first by default", () => {
    // The old parser assumed month/day, so this returned June 7th (ROS-6).
    expect(coerceISODate("6/7/2025")).toBe("2025-07-06");
  });

  it("honours dayFirst: false when asked", () => {
    expect(coerceISODate("6/7/2025", { dayFirst: false })).toBe("2025-06-07");
  });

  it("infers the order when one value can only be a day", () => {
    expect(coerceISODate("27/6/2025")).toBe("2025-06-27");
    expect(coerceISODate("6/27/2025")).toBe("2025-06-27");
  });

  it("anchors a year-less register header to the supplied year", () => {
    expect(coerceISODate("SUN 30/11", { year: 2024 })).toBe("2024-11-30");
    expect(coerceISODate("WED 26/11", { year: 2024 })).toBe("2024-11-26");
  });

  it("expands a two-digit year", () => {
    expect(coerceISODate("09/03/25")).toBe("2025-03-09");
  });

  it("reads textual months in either order", () => {
    expect(coerceISODate("12 March 2025")).toBe("2025-03-12");
    expect(coerceISODate("March 12 2025")).toBe("2025-03-12");
    expect(coerceISODate("Mar 12", { year: 2025 })).toBe("2025-03-12");
  });

  it("rejects unreadable and empty values", () => {
    expect(coerceISODate("")).toBeNull();
    expect(coerceISODate(null)).toBeNull();
    expect(coerceISODate("n/a")).toBeNull();
    expect(coerceISODate("NAME")).toBeNull();
  });

  it("rejects an impossible month", () => {
    expect(coerceISODate("40/40/2025")).toBeNull();
  });
});

describe("parseBirthday", () => {
  it("is day-first for ambiguous values", () => {
    expect(parseBirthday("6/7")).toEqual({ month: 7, day: 6 });
  });

  it("infers the order when one value can only be a day", () => {
    expect(parseBirthday("27/6")).toEqual({ month: 6, day: 27 });
    expect(parseBirthday("6/27")).toEqual({ month: 6, day: 27 });
  });

  it("reads a textual month", () => {
    expect(parseBirthday("June 27")).toEqual({ month: 6, day: 27 });
  });

  it("returns null for junk", () => {
    expect(parseBirthday("")).toBeNull();
    expect(parseBirthday("not a date")).toBeNull();
  });
});

describe("isoDaysAgo", () => {
  it("returns a well-formed calendar date", () => {
    expect(isoDaysAgo(56)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is earlier than today", () => {
    expect(isoDaysAgo(56) < toISODate(new Date())).toBe(true);
  });
});
