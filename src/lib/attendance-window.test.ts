import { describe, it, expect } from "vitest";
import {
  deadlineFor,
  isLate,
  formatWAT,
  mostRecent,
  openServiceDates,
  morningReminderFor,
  finalReminderFor,
  SUNDAY,
  WEDNESDAY,
  sundayOfWeek,
  weekServices,
  shiftWeeks,
  hasOccurred,
  currentWeekSunday,
} from "./attendance-window";

// The two real reports in the fixtures are for Sunday 4/10/2026 and Wednesday
// 7/10/2026, so those dates anchor these tests.
describe("deadlineFor", () => {
  it("puts the Sunday report due Monday 8PM WAT", () => {
    // 2026-10-04 is a Sunday → Monday the 5th, 20:00 WAT → 19:00 UTC.
    expect(deadlineFor("2026-10-04").toISOString()).toBe("2026-10-05T19:00:00.000Z");
  });

  it("puts the Wednesday report due Thursday 8PM WAT", () => {
    expect(deadlineFor("2026-10-07").toISOString()).toBe("2026-10-08T19:00:00.000Z");
  });

  it("rolls over a month end", () => {
    expect(deadlineFor("2026-10-31").toISOString()).toBe("2026-11-01T19:00:00.000Z");
  });

  it("rolls over a year end", () => {
    expect(deadlineFor("2026-12-31").toISOString()).toBe("2027-01-01T19:00:00.000Z");
  });

  it("handles a leap day", () => {
    expect(deadlineFor("2028-02-28").toISOString()).toBe("2028-02-29T19:00:00.000Z");
    expect(deadlineFor("2028-02-29").toISOString()).toBe("2028-03-01T19:00:00.000Z");
  });

  it("rejects something that isn't an ISO date", () => {
    expect(() => deadlineFor("4/10/2026")).toThrow();
  });
});

describe("isLate — the hour that matters", () => {
  const service = "2026-10-04";

  it("is on time one minute before 8PM WAT", () => {
    expect(isLate(service, new Date("2026-10-05T18:59:00Z"))).toBe(false);
  });

  it("is late one minute after 8PM WAT", () => {
    expect(isLate(service, new Date("2026-10-05T19:01:00Z"))).toBe(true);
  });

  it("is NOT late at 7:30PM WAT, even though that is past 8PM UTC", () => {
    // This is the regression that matters. A server running in UTC would read
    // 18:30Z as "past 20:00" if the offset were ignored, and stamp a perfectly
    // punctual leader as late every single week.
    expect(isLate(service, new Date("2026-10-05T18:30:00Z"))).toBe(false);
  });

  it("is late the next morning", () => {
    expect(isLate(service, new Date("2026-10-06T08:00:00Z"))).toBe(true);
  });
});

describe("reminders", () => {
  it("sends the morning nudge at 9AM WAT on the due day", () => {
    expect(morningReminderFor("2026-10-04").toISOString()).toBe("2026-10-05T08:00:00.000Z");
  });

  it("sends the final nudge two hours before the deadline", () => {
    expect(finalReminderFor("2026-10-04").toISOString()).toBe("2026-10-05T17:00:00.000Z");
  });

  it("orders morning before final before deadline", () => {
    const d = "2026-10-07";
    expect(morningReminderFor(d).getTime()).toBeLessThan(finalReminderFor(d).getTime());
    expect(finalReminderFor(d).getTime()).toBeLessThan(deadlineFor(d).getTime());
  });
});

describe("mostRecent", () => {
  it("returns today when today IS that weekday", () => {
    // 2026-10-04T10:00Z is a Sunday in WAT (11:00 WAT).
    expect(mostRecent(SUNDAY, new Date("2026-10-04T10:00:00Z"))).toBe("2026-10-04");
  });

  it("walks back to the previous occurrence", () => {
    // Thursday 2026-10-08 → most recent Wednesday is the 7th, Sunday the 4th.
    expect(mostRecent(WEDNESDAY, new Date("2026-10-08T10:00:00Z"))).toBe("2026-10-07");
    expect(mostRecent(SUNDAY, new Date("2026-10-08T10:00:00Z"))).toBe("2026-10-04");
  });

  it("uses the WAT day, not the UTC day", () => {
    // 2026-10-04T23:30Z is still Sunday in UTC but already Monday 00:30 in WAT.
    // The most recent Sunday is therefore the 4th either way, but the most
    // recent Wednesday must be the 30th of September, not the 7th of October.
    expect(mostRecent(WEDNESDAY, new Date("2026-10-04T23:30:00Z"))).toBe("2026-09-30");
  });
});

describe("openServiceDates", () => {
  it("names both services awaiting a report", () => {
    expect(openServiceDates(new Date("2026-10-08T10:00:00Z"))).toEqual({
      sunday: "2026-10-04",
      wednesday: "2026-10-07",
    });
  });
});

describe("formatWAT", () => {
  it("shows the deadline in the time the team actually works to", () => {
    expect(formatWAT(deadlineFor("2026-10-04"))).toBe("Monday 5/10, 8:00PM");
    expect(formatWAT(deadlineFor("2026-10-07"))).toBe("Thursday 8/10, 8:00PM");
  });

  it("renders midnight and noon correctly", () => {
    expect(formatWAT(new Date("2026-10-04T23:00:00Z"))).toContain("12:00AM");
    expect(formatWAT(new Date("2026-10-04T11:00:00Z"))).toContain("12:00PM");
  });
});

describe("week navigation", () => {
  it("finds the Sunday that opens a week", () => {
    expect(sundayOfWeek("2026-10-04")).toBe("2026-10-04"); // a Sunday itself
    expect(sundayOfWeek("2026-10-07")).toBe("2026-10-04"); // the Wednesday after
    expect(sundayOfWeek("2026-10-10")).toBe("2026-10-04"); // the Saturday after
    expect(sundayOfWeek("2026-10-11")).toBe("2026-10-11"); // the next Sunday
  });

  it("pairs each Sunday with the Wednesday of the same reporting week", () => {
    expect(weekServices("2026-10-04")).toEqual({
      sunday: "2026-10-04",
      wednesday: "2026-10-07",
    });
  });

  it("steps backwards and forwards by whole weeks", () => {
    expect(shiftWeeks("2026-10-04", -1)).toBe("2026-09-27");
    expect(shiftWeeks("2026-10-04", 1)).toBe("2026-10-11");
    expect(shiftWeeks("2026-10-04", -5)).toBe("2026-08-30");
  });

  it("steps across a month and a year boundary", () => {
    expect(shiftWeeks("2026-01-03", -1)).toBe("2025-12-27");
    expect(shiftWeeks("2026-12-27", 1)).toBe("2027-01-03");
  });

  it("keeps every step landing on a Sunday", () => {
    let d = "2026-10-04";
    for (let i = 0; i < 60; i++) {
      d = shiftWeeks(d, -1);
      const [y, m, day] = d.split("-").map(Number);
      expect(new Date(Date.UTC(y, m - 1, day)).getUTCDay(), `${d} is not a Sunday`).toBe(0);
    }
  });

  it("knows whether a service has been held yet", () => {
    const monday = new Date("2026-10-05T10:00:00Z");
    expect(hasOccurred("2026-10-04", monday)).toBe(true); // yesterday's Sunday
    expect(hasOccurred("2026-10-05", monday)).toBe(true); // today
    expect(hasOccurred("2026-10-07", monday)).toBe(false); // Wednesday to come
  });

  it("uses the WAT day when deciding what is still in the future", () => {
    // 23:30Z on the 6th is already the 7th in WAT, so Wednesday has arrived.
    expect(hasOccurred("2026-10-07", new Date("2026-10-06T23:30:00Z"))).toBe(true);
    expect(hasOccurred("2026-10-07", new Date("2026-10-06T22:00:00Z"))).toBe(false);
  });

  it("reports the current week from any day in it", () => {
    expect(currentWeekSunday(new Date("2026-10-08T10:00:00Z"))).toBe("2026-10-04");
    expect(currentWeekSunday(new Date("2026-10-04T06:00:00Z"))).toBe("2026-10-04");
  });
});
