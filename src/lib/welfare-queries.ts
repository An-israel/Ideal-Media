import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

export interface BirthdayPerson {
  name: string;
  whatsapp: string | null;
  daysUntil: number;
  label: string; // e.g. "Jun 27"
}

/** Today's + upcoming (next `windowDays`) birthdays among active members. */
export async function getBirthdays(
  supabase: SupabaseClient<Database>,
  windowDays = 14
): Promise<{ today: BirthdayPerson[]; upcoming: BirthdayPerson[] }> {
  const { data } = await supabase
    .from("profiles")
    .select("full_name, whatsapp_number, birth_month, birth_day")
    .eq("member_status", "active")
    .not("birth_month", "is", null);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const people: BirthdayPerson[] = [];
  for (const p of data ?? []) {
    const m = p.birth_month as number | null;
    const d = p.birth_day as number | null;
    if (!m || !d) continue;
    let next = new Date(now.getFullYear(), m - 1, d);
    if (next < startOfToday) next = new Date(now.getFullYear() + 1, m - 1, d);
    const daysUntil = Math.round((next.getTime() - startOfToday.getTime()) / 86_400_000);
    people.push({
      name: p.full_name,
      whatsapp: p.whatsapp_number,
      daysUntil,
      label: `${months[m - 1]} ${d}`,
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
 * Trailing consecutive missed (absent) sessions per user for the signal
 * activity — powers the "missed N Sundays" label on the welfare board.
 */
export async function getMissedCounts(userIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (userIds.length === 0) return result;

  const admin = createAdminClient();
  const { data: activity } = await admin
    .from("activities")
    .select("id")
    .eq("is_attendance_signal", true)
    .limit(1)
    .maybeSingle();
  if (!activity) return result;

  const { data: records } = await admin
    .from("attendance_records")
    .select("user_id, service_date, status")
    .eq("activity_id", activity.id)
    .in("user_id", userIds)
    .order("service_date", { ascending: false });

  // Group by user (already newest-first), count leading absents.
  const byUser = new Map<string, { service_date: string; status: string }[]>();
  for (const r of records ?? []) {
    const list = byUser.get(r.user_id) ?? [];
    list.push(r);
    byUser.set(r.user_id, list);
  }
  for (const [userId, list] of byUser) {
    let count = 0;
    for (const r of list) {
      if (r.status === "absent") count++;
      else break;
    }
    result.set(userId, count);
  }
  return result;
}
