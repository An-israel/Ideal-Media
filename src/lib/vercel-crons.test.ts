import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Guards vercel.json against a schedule that cannot deploy.
 *
 * Vercel's Hobby plan only accepts cron schedules that run AT MOST ONCE PER
 * DAY. A sub-daily expression is rejected during deploy validation — before a
 * deployment record is created — so the build never appears in the dashboard,
 * nothing in CI fails, and the live site silently keeps serving the previous
 * commit. That is exactly how an hourly reminder cron took the whole attendance
 * feature off the live site while every local check passed.
 *
 * If the project moves to Pro, relax this test deliberately rather than by
 * accident.
 */
const cfg = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "vercel.json"), "utf8")
) as { crons?: { path: string; schedule: string }[] };

const crons = cfg.crons ?? [];

/** True when the expression can fire more than once in a day. */
function firesMoreThanDaily(schedule: string): boolean {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return true; // not a shape we can vouch for
  const [minute, hour] = parts;
  // A single fixed minute and a single fixed hour is once per day. Anything
  // else — a list, a range, a step, or a wildcard — can fire repeatedly.
  const fixed = (f: string) => /^\d+$/.test(f);
  return !(fixed(minute) && fixed(hour));
}

describe("vercel.json cron schedules", () => {
  it("defines at least one cron", () => {
    expect(crons.length).toBeGreaterThan(0);
  });

  it.each(crons.map((c) => [c.path, c.schedule]))(
    "%s runs at most once a day (%s)",
    (path, schedule) => {
      expect(firesMoreThanDaily(schedule as string), `${path} would be rejected by Vercel`).toBe(
        false
      );
    }
  );

  it("points every cron at a route that exists", () => {
    for (const c of crons) {
      const route = join(__dirname, "..", "app", c.path, "route.ts");
      expect(() => readFileSync(route, "utf8"), `${c.path} has no route file`).not.toThrow();
    }
  });
});

describe("firesMoreThanDaily", () => {
  it("accepts a fixed time", () => {
    expect(firesMoreThanDaily("0 6 * * *")).toBe(false);
    expect(firesMoreThanDaily("30 17 * * 1")).toBe(false);
  });

  it("rejects the shapes Vercel's Hobby plan refuses", () => {
    expect(firesMoreThanDaily("0 * * * *")).toBe(true); // hourly — the one that broke us
    expect(firesMoreThanDaily("*/15 * * * *")).toBe(true);
    expect(firesMoreThanDaily("0 */4 * * *")).toBe(true);
    expect(firesMoreThanDaily("0 9,18 * * *")).toBe(true);
    expect(firesMoreThanDaily("0 9-17 * * *")).toBe(true);
    expect(firesMoreThanDaily("* * * * *")).toBe(true);
  });
});
