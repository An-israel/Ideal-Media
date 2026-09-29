import { describe, it, expect } from "vitest";
import { listenPercent, qualifiesAsListened, clampPlayedIncrement } from "./training-progress";
import { TEACHING_COMPLETE_FRACTION } from "./constants";
import { formatDuration, formatClock } from "./format";

const HOUR = 3600;

describe("listenPercent", () => {
  it("reports the fraction actually played", () => {
    expect(listenPercent(1800, HOUR)).toBe(50);
    expect(listenPercent(HOUR, HOUR)).toBe(100);
  });

  it("never exceeds 100 even after replays", () => {
    expect(listenPercent(HOUR * 3, HOUR)).toBe(100);
  });

  it("is 0 when nothing has been played", () => {
    expect(listenPercent(0, HOUR)).toBe(0);
  });

  it("is 0 when the duration isn't known yet", () => {
    expect(listenPercent(600, null)).toBe(0);
    expect(listenPercent(600, 0)).toBe(0);
  });

  it("reports 100 for a completed teaching even with no duration", () => {
    // Someone who ticked "I listened elsewhere" has no measured duration.
    expect(listenPercent(0, null, true)).toBe(100);
  });

  it("ignores nonsense input rather than producing NaN", () => {
    expect(listenPercent(Number.NaN, HOUR)).toBe(0);
    expect(listenPercent(-500, HOUR)).toBe(0);
  });
});

describe("qualifiesAsListened", () => {
  it("is true at the completion threshold", () => {
    expect(qualifiesAsListened(HOUR * TEACHING_COMPLETE_FRACTION, HOUR)).toBe(true);
  });

  it("is false just below it", () => {
    expect(qualifiesAsListened(HOUR * TEACHING_COMPLETE_FRACTION - 1, HOUR)).toBe(false);
  });

  it("does not complete from seeking to the end", () => {
    // The whole point: the playhead reached the end but only 30s was played.
    expect(qualifiesAsListened(30, HOUR)).toBe(false);
  });

  it("is false while the duration is unknown", () => {
    expect(qualifiesAsListened(9999, null)).toBe(false);
    expect(qualifiesAsListened(9999, 0)).toBe(false);
  });

  it("allows skipping a short intro or trailing silence", () => {
    // 95% played on a 45-minute teaching should count.
    expect(qualifiesAsListened(2565, 2700)).toBe(true);
  });
});

describe("clampPlayedIncrement", () => {
  it("passes a normal reporting tick through", () => {
    expect(clampPlayedIncrement(15)).toBe(15);
  });

  it("caps an implausible claim", () => {
    // A client claiming it played an hour in one 15-second tick.
    expect(clampPlayedIncrement(3600)).toBe(60);
  });

  it("rejects negatives and nonsense", () => {
    expect(clampPlayedIncrement(-30)).toBe(0);
    expect(clampPlayedIncrement(Number.NaN)).toBe(0);
    expect(clampPlayedIncrement(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("rounds to whole seconds", () => {
    expect(clampPlayedIncrement(14.6)).toBe(15);
  });

  it("honours a custom cap", () => {
    expect(clampPlayedIncrement(100, 20)).toBe(20);
  });
});

describe("a member cannot fake a completion by spamming the endpoint", () => {
  it("takes the real number of ticks to complete an hour-long teaching", () => {
    // Each request can only ever add the clamped maximum, so completing a
    // 1-hour teaching needs at least 54 separate requests spread over real time.
    const perRequest = clampPlayedIncrement(999999);
    const needed = Math.ceil((HOUR * TEACHING_COMPLETE_FRACTION) / perRequest);
    expect(perRequest).toBe(60);
    expect(needed).toBe(54);
    expect(qualifiesAsListened(perRequest, HOUR)).toBe(false);
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(2700)).toBe("45 min");
    expect(formatDuration(4320)).toBe("1h 12m");
    expect(formatDuration(HOUR)).toBe("1h");
    expect(formatDuration(45)).toBe("45s");
  });

  it("says so when the length isn't known", () => {
    expect(formatDuration(null)).toBe("Length unknown");
    expect(formatDuration(0)).toBe("Length unknown");
    expect(formatDuration(undefined)).toBe("Length unknown");
  });
});

describe("formatClock", () => {
  it("formats as a media clock", () => {
    expect(formatClock(425)).toBe("7:05");
    expect(formatClock(4025)).toBe("1:07:05");
    expect(formatClock(0)).toBe("0:00");
  });

  it("handles missing values without crashing", () => {
    expect(formatClock(null)).toBe("0:00");
    expect(formatClock(undefined)).toBe("0:00");
    expect(formatClock(-10)).toBe("0:00");
  });
});
