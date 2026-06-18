import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

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
