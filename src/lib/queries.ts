import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ATTENDANCE_WINDOW_WEEKS } from "@/lib/constants";
import { compositeScore, type PerformanceParts } from "@/lib/performance";

type DB = SupabaseClient<Database>;

/**
 * Computes a member's composite performance parts (Section 14). Reusable by the
 * member dashboard and the leader/admin member views. Reads are RLS-scoped to
 * whatever the caller's client can see.
 */
export async function getMemberPerformance(
  supabase: DB,
  userId: string
): Promise<{ parts: PerformanceParts; composite: number }> {
  // Enrolled courses → their modules → this member's progress.
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("course_id")
    .eq("user_id", userId)
    .eq("status", "enrolled");

  const courseIds = (enrollments ?? []).map((e) => e.course_id);

  let totalModules = 0;
  let approvedModules = 0;
  if (courseIds.length) {
    const { data: modules } = await supabase
      .from("modules")
      .select("id")
      .in("course_id", courseIds);
    totalModules = (modules ?? []).length;
  }

  const { data: progress } = await supabase
    .from("module_progress")
    .select("status, rejection_note")
    .eq("user_id", userId);

  approvedModules = (progress ?? []).filter((p) => p.status === "approved").length;

  // Assignment approval rate: approved / (approved + currently-rejected attempts).
  const rejected = (progress ?? []).filter((p) => p.rejection_note && p.status !== "approved")
    .length;
  const assignmentsDenom = approvedModules + rejected;

  // Attendance over the trailing window, signal activities only.
  const since = new Date();
  since.setDate(since.getDate() - ATTENDANCE_WINDOW_WEEKS * 7);
  const { data: attendance } = await supabase
    .from("attendance_records")
    .select("status, service_date")
    .eq("user_id", userId)
    .gte("service_date", since.toISOString().slice(0, 10));

  const counted = (attendance ?? []).filter(
    (a) => a.status === "present" || a.status === "absent"
  );
  const present = counted.filter((a) => a.status === "present").length;

  const parts: PerformanceParts = {
    progress: totalModules ? approvedModules / totalModules : 0,
    assignments: assignmentsDenom ? approvedModules / assignmentsDenom : 0,
    attendance: counted.length ? present / counted.length : 0,
  };

  return { parts, composite: compositeScore(parts) };
}
