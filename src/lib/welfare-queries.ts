import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/pagination";
import { getSignalActivityIds } from "@/lib/welfare-automation";

export interface BirthdayPerson {
  name: string;
  whatsapp: string | null;
  daysUntil: number;
  label: string; // e.g. "Jun 27"
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Today's + upcoming (next `windowDays`) birthdays among active members.
 *
 * Day arithmetic is done on calendar values rather than timestamps, so the
 * window doesn't shift with the server's timezone (AUDIT WEL-8).
 */
export async function getBirthdays(
  supabase: SupabaseClient<Database>,
  windowDays = 14
): Promise<{ today: BirthdayPerson[]; upcoming: BirthdayPerson[] }> {
  const data = await fetchAllRows<{
    full_name: string;
    whatsapp_number: string | null;
    birth_month: number | null;
    birth_day: number | null;
  }>((from, to) =>
    supabase
      .from("profiles")
      .select("full_name, whatsapp_number, birth_month, birth_day")
      .eq("member_status", "active")
      .not("birth_month", "is", null)
      .range(from, to)
  );

  const now = new Date();
  // Local midnight today — both ends of the subtraction are midnights, so DST
  // shifts cancel and daysUntil stays a whole number of calendar days.
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const people: BirthdayPerson[] = [];
  for (const p of data) {
    const m = p.birth_month;
    const d = p.birth_day;
    if (!m || !d) continue;
    let next = new Date(now.getFullYear(), m - 1, d);
    if (next < startOfToday) next = new Date(now.getFullYear() + 1, m - 1, d);
    const daysUntil = Math.round((next.getTime() - startOfToday.getTime()) / 86_400_000);
    people.push({
      name: p.full_name,
      whatsapp: p.whatsapp_number,
      daysUntil,
      label: `${MONTHS[m - 1]} ${d}`,
    });
  }
  people.sort((a, b) => a.daysUntil - b.daysUntil);

  return {
    today: people.filter((p) => p.daysUntil === 0),
    upcoming: people.filter((p) => p.daysUntil > 0 && p.daysUntil <= windowDays),
  };
}

/** Welfare team members (for the assignment dropdown). Admin read — welfare
 * users cannot list other users' roles under RLS. */
export async function getWelfareTeam(): Promise<{ id: string; full_name: string }[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("user_roles")
    .select("user_id, profiles(full_name)")
    .eq("role", "welfare");

  type Row = { user_id: string; profiles: { full_name: string } | null };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.profiles)
    .map((r) => ({ id: r.user_id, full_name: r.profiles!.full_name }));
}

/**
 * Trailing consecutive missed (absent) sessions per user across the signal
 * activities — powers the "missed N Sundays" label on the welfare board.
 *
 * Two fixes here:
 *   - Every signal activity counts, and the worst streak wins (AUDIT WEL-2).
 *     The old query was `.eq("is_attendance_signal", true).limit(1)` with no
 *     `order()`, so with more than one signal activity configured it picked an
 *     arbitrary one that could change between requests.
 *   - Records are paged (AUDIT PERF-3). The unbounded read capped at 1000 rows,
 *     so the newest records for later users were missing and the badge was
 *     simply wrong.
 */
export async function getMissedCounts(userIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (userIds.length === 0) return result;

  const admin = createAdminClient();
  const activityIds = await getSignalActivityIds(admin);
  if (activityIds.length === 0) return result;

  const records = await fetchAllRows<{
    user_id: string;
    activity_id: string;
    service_date: string;
    status: string;
  }>((from, to) =>
    admin
      .from("attendance_records")
      .select("user_id, activity_id, service_date, status")
      .in("activity_id", activityIds)
      .in("user_id", userIds)
      .order("service_date", { ascending: false })
      .range(from, to)
  );

  // Group by (user, activity) so streaks from different activities don't
  // interleave, then keep each user's longest trailing absence run.
  const byUserActivity = new Map<string, { service_date: string; status: string }[]>();
  for (const r of records) {
    const key = `${r.user_id}|${r.activity_id}`;
    const list = byUserActivity.get(key) ?? [];
    list.push({ service_date: r.service_date, status: r.status });
    byUserActivity.set(key, list);
  }

  for (const [key, list] of byUserActivity) {
    const userId = key.split("|")[0];
    // fetchAllRows preserves the query's newest-first order within a page, but
    // pages are concatenated — sort so the streak is measured from the newest.
    list.sort((a, b) => (a.service_date < b.service_date ? 1 : -1));
    let count = 0;
    for (const r of list) {
      if (r.status === "absent") count++;
      else break;
    }
    result.set(userId, Math.max(result.get(userId) ?? 0, count));
  }
  return result;
}
