/**
 * Date helpers for service dates (AUDIT ATT-6).
 *
 * A service date is a calendar day, not an instant. The old code did
 * `new Date(cell).toISOString().slice(0, 10)`, which parses in the server's
 * local zone and then formats in UTC — so on any server behind UTC the date
 * shifted back a day and attendance landed on a service that never happened.
 * These helpers keep everything in calendar-day terms.
 */

/** Formats a Date as YYYY-MM-DD using its LOCAL components (never UTC). */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today as YYYY-MM-DD. */
export function todayISO(): string {
  return toISODate(new Date());
}

/** YYYY-MM-DD for `days` before today. */
export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toISODate(d);
}

const MONTH_NAMES = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

/**
 * Coerces a spreadsheet cell to YYYY-MM-DD, or null if it can't be read.
 *
 * `dayFirst` controls how an ambiguous numeric date like "6/7" is read.
 * Registers here are written day/month, so that is the default — the previous
 * code assumed month/day and silently mis-dated every ambiguous cell.
 */
export function coerceISODate(
  value: unknown,
  opts?: { dayFirst?: boolean; year?: number }
): string | null {
  const dayFirst = opts?.dayFirst ?? true;

  // SheetJS with cellDates:true hands back real Dates. Use local components —
  // the date it parsed is the date the sheet meant.
  if (value instanceof Date && !isNaN(value.getTime())) return toISODate(value);

  const s = String(value ?? "").trim();
  if (!s) return null;

  // Already ISO.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // Numeric: d/m/y, d/m, or m/d/y depending on dayFirst.
  const num = s.match(/(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?:\s*[/.\-]\s*(\d{2,4}))?/);
  if (num) {
    const a = Number(num[1]);
    const b = Number(num[2]);
    // If one value can only be a day, that settles the order regardless.
    let day: number;
    let month: number;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      day = b;
      month = a;
    } else if (dayFirst) {
      day = a;
      month = b;
    } else {
      day = b;
      month = a;
    }

    let year = opts?.year ?? new Date().getFullYear();
    if (num[3]) {
      const raw = Number(num[3]);
      year = raw < 100 ? 2000 + raw : raw;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // Textual month: "12 March 2025", "Mar 12", "March 12 2025".
  const monthMatch = s.toLowerCase().match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
  if (monthMatch) {
    const month = MONTH_NAMES.indexOf(monthMatch[1]) + 1;
    const numbers = s.match(/\d{1,4}/g) ?? [];
    const dayNum = numbers.map(Number).find((n) => n >= 1 && n <= 31);
    const yearNum = numbers.map(Number).find((n) => n >= 1900);
    if (!dayNum) return null;
    const year = yearNum ?? opts?.year ?? new Date().getFullYear();
    return `${year}-${String(month).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
  }

  return null;
}

/**
 * Parses a birthday cell to {month, day}. Year is never stored.
 * Day-first by default, matching how the registers are written (AUDIT ROS-6).
 */
export function parseBirthday(
  raw: string,
  opts?: { dayFirst?: boolean }
): { month: number; day: number } | null {
  const isoDate = coerceISODate(raw, { dayFirst: opts?.dayFirst ?? true, year: 2000 });
  if (!isoDate) return null;
  const [, m, d] = isoDate.split("-");
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}
