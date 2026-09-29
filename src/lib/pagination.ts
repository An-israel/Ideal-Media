import "server-only";
import { PAGE_SIZE } from "@/lib/constants";

export interface FetchAllOptions {
  /** Rows per request. PostgREST's own ceiling is 1000. */
  pageSize?: number;
  /**
   * Hard stop, so a query that keeps returning full pages can never loop
   * forever. Also used deliberately to bound a read that only needs recent
   * history (e.g. the secretary grid's last few hundred service records).
   */
  maxPages?: number;
}

/**
 * Reads every row of a query by paging through it (AUDIT PERF-2).
 *
 * PostgREST caps an unbounded `select()` at 1000 rows and returns **no error**,
 * so code that assumed it had the whole table quietly got the first page and
 * produced wrong answers — duplicate accounts at signup because claim-matching
 * couldn't see the member, attendance charts frozen on the oldest data, welfare
 * counts computed on truncated history.
 *
 * Pass a factory that applies `.range(from, to)` to your query:
 *
 *   const profiles = await fetchAllRows((from, to) =>
 *     admin.from("profiles").select("id, email").range(from, to)
 *   );
 *
 * Throws on a query error rather than silently returning a short list — a
 * partial result here is the bug we're fixing.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  opts: FetchAllOptions = {}
): Promise<T[]> {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const maxPages = opts.maxPages ?? 50;
  const all: T[] = [];
  for (let i = 0; i < maxPages; i++) {
    const from = i * pageSize;
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    // A short page means we've reached the end.
    if (rows.length < pageSize) break;
  }
  return all;
}

/** Splits an array into chunks of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
