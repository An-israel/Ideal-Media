/**
 * Supabase/PostgREST caps any single read at 1000 rows. This pages through a
 * query so member/profile/attendance lists never silently truncate as the
 * team grows past 1000 records.
 *
 * Usage:
 *   const profiles = await fetchAllPages((from, to) =>
 *     admin.from("profiles").select("id, email").range(from, to)
 *   );
 */
export async function fetchAllPages<T>(
  fetchPage: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  opts?: { maxPages?: number }
): Promise<T[]> {
  const PAGE = 1000;
  const maxPages = opts?.maxPages ?? 50;
  const out: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * PAGE;
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}
