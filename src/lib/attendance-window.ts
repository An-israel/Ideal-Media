/**
 * Submission deadlines for the weekly attendance report.
 *
 * Sunday Service is reported by Monday 8PM; Bible Study (Wednesday) by
 * Thursday 8PM. Both are "the day after the service, 20:00" — so one rule
 * covers them and any future midweek activity.
 *
 * Times are West Africa Time, which is UTC+1 all year with no daylight saving.
 * That fixed offset is why this can be plain arithmetic rather than a timezone
 * library: 20:00 WAT is always 19:00 UTC. A server running in UTC (Vercel
 * does) would otherwise stamp submissions late by an hour, every week.
 */

export const WAT_OFFSET_HOURS = 1;
export const DEADLINE_HOUR_WAT = 20;
/** Reminders go out this many hours before the deadline, and on the morning. */
export const REMINDER_HOURS_BEFORE = 2;
export const MORNING_REMINDER_HOUR_WAT = 9;

/** Parses an ISO `yyyy-mm-dd` as a calendar day, with no timezone shifting. */
function parseISODate(iso: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Not an ISO date: ${iso}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/**
 * The instant a report for `serviceDate` is due.
 *
 * Returns a real Date (an absolute instant), built from the WAT wall-clock
 * time the team actually works to.
 */
export function deadlineFor(serviceDate: string): Date {
  const { y, m, d } = parseISODate(serviceDate);
  // Day after the service, 20:00 WAT == 19:00 UTC. Date.UTC normalises the
  // month/day rollover, so the 31st and leap days need no special casing.
  return new Date(Date.UTC(y, m - 1, d + 1, DEADLINE_HOUR_WAT - WAT_OFFSET_HOURS, 0, 0, 0));
}

export function isLate(serviceDate: string, submittedAt: Date = new Date()): boolean {
  return submittedAt.getTime() > deadlineFor(serviceDate).getTime();
}

/** The morning nudge on the day the report is due. */
export function morningReminderFor(serviceDate: string): Date {
  const { y, m, d } = parseISODate(serviceDate);
  return new Date(
    Date.UTC(y, m - 1, d + 1, MORNING_REMINDER_HOUR_WAT - WAT_OFFSET_HOURS, 0, 0, 0)
  );
}

/** The final nudge, two hours before the deadline. */
export function finalReminderFor(serviceDate: string): Date {
  return new Date(deadlineFor(serviceDate).getTime() - REMINDER_HOURS_BEFORE * 3600_000);
}

/** Formats an instant as WAT wall-clock, for showing a deadline to a human. */
export function formatWAT(instant: Date): string {
  const shifted = new Date(instant.getTime() + WAT_OFFSET_HOURS * 3600_000);
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const hh = shifted.getUTCHours();
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  const suffix = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${days[shifted.getUTCDay()]} ${shifted.getUTCDate()}/${
    shifted.getUTCMonth() + 1
  }, ${h12}:${mm}${suffix}`;
}

/** The ISO date of the most recent occurrence of `weekday` on or before today. */
export function mostRecent(weekday: number, today: Date = new Date()): string {
  // Work in WAT so "today" flips at WAT midnight, not UTC midnight.
  const wat = new Date(today.getTime() + WAT_OFFSET_HOURS * 3600_000);
  const back = (wat.getUTCDay() - weekday + 7) % 7;
  const d = new Date(Date.UTC(wat.getUTCFullYear(), wat.getUTCMonth(), wat.getUTCDate() - back));
  return d.toISOString().slice(0, 10);
}

export const SUNDAY = 0;
export const WEDNESDAY = 3;

/**
 * The service dates a report is currently expected for: the most recent Sunday
 * and the most recent Wednesday.
 */
export function openServiceDates(today: Date = new Date()): {
  sunday: string;
  wednesday: string;
} {
  return { sunday: mostRecent(SUNDAY, today), wednesday: mostRecent(WEDNESDAY, today) };
}
