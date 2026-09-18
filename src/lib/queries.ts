import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ATTENDANCE_WINDOW_WEEKS } from "@/lib/constants";
import { compositeScore, type PerformanceParts } from "@/lib/performance";
import { fetchAllRows } from "@/lib/pagination";
import { isoDaysAgo } from "@/lib/dates";

type DB = SupabaseClient<Database>;

export interface MemberPerformance {
  parts: PerformanceParts;
  composite: number;
  /** False when the member has no attendance history in the window at all. */
  hasAttendanceData: boolean;
}

const EMPTY: MemberPerformance = {
  parts: { progress: 0, assignments: 0, attendance: 0 },
  composite: 0,
  hasAttendanceData: false,
};

/**
 * Computes composite performance parts for MANY members in a fixed number of
 * queries (Section 14).
 *
 * This replaces the per-member version on list pages (AUDIT PERF-1). The
 * leader members page called `getMemberPerformance` inside a `Promise.all` over
 * every member, and each call issued 4 RLS-scoped queries — roughly 800 queries
 * on one page load for a 200-member subunit, which times out long before the
 * team outgrows the app.
 *
 * Reads are RLS-scoped to whatever the caller's client can see.
 */
export async function getMemberPerformances(
  supabase: DB,
  userIds: string[]
): Promise<Map<string, MemberPerformance>> {
  const result = new Map<string, MemberPerformance>();
  if (userIds.length === 0) return result;
  for (const id of userIds) result.set(id, { ...EMPTY });

  const since = isoDaysAgo(ATTENDANCE_WINDOW_WEEKS * 7);
  const window = currentAttendanceWindowPeriods();

  const [enrollments, progress, attendance, summaries] = await Promise.all([
    fetchAllRows<{ user_id: string; course_id: string }>((from, to) =>
      supabase
        .from("enrollments")
        .select("user_id, course_id")
        .in("user_id", userIds)
        .eq("status", "enrolled")
        .range(from, to)
    ),
    fetchAllRows<{
      user_id: string;
      module_id: string;
      status: string;
      rejection_count: number;
    }>((from, to) =>
      supabase
        .from("module_progress")
        .select("user_id, module_id, status, rejection_count")
        .in("user_id", userIds)
        .range(from, to)
    ),
    fetchAllRows<{ user_id: string; status: string; service_date: string }>((from, to) =>
      supabase
        .from("attendance_records")
        .select("user_id, status, service_date")
        .in("user_id", userIds)
        .gte("service_date", since)
        .range(from, to)
    ),
    // Imported monthly tallies count toward attendance (AUDIT ATT-10). They
    // were written by the wide import and shown on the secretary page, but
    // never read here — so history you took the trouble to import contributed
    // nothing to anyone's score.
    fetchAllRows<{ user_id: string; period: string; count: number }>((from, to) =>
      supabase
        .from("monthly_attendance_summary")
        .select("user_id, period, count")
        .in("user_id", userIds)
        .in("period", window.periods)
        .range(from, to)
    ),
  ]);

  // Modules per enrolled course, fetched once for the whole page.
  const allCourseIds = [...new Set(enrollments.map((e) => e.course_id))];
  const modules = allCourseIds.length
    ? await fetchAllRows<{ id: string; course_id: string }>((from, to) =>
        supabase.from("modules").select("id, course_id").in("course_id", allCourseIds).range(from, to)
      )
    : [];

  const moduleCountByCourse = new Map<string, number>();
  const courseByModule = new Map<string, string>();
  for (const m of modules) {
    moduleCountByCourse.set(m.course_id, (moduleCountByCourse.get(m.course_id) ?? 0) + 1);
    courseByModule.set(m.id, m.course_id);
  }

  const enrolledCoursesByUser = new Map<string, Set<string>>();
  for (const e of enrollments) {
    const set = enrolledCoursesByUser.get(e.user_id) ?? new Set<string>();
    set.add(e.course_id);
    enrolledCoursesByUser.set(e.user_id, set);
  }

  const progressByUser = new Map<string, typeof progress>();
  for (const p of progress) {
    progressByUser.set(p.user_id, [...(progressByUser.get(p.user_id) ?? []), p]);
  }

  const attendanceByUser = new Map<string, typeof attendance>();
  for (const a of attendance) {
    attendanceByUser.set(a.user_id, [...(attendanceByUser.get(a.user_id) ?? []), a]);
  }

  const summaryByUser = new Map<string, number>();
  for (const s of summaries) {
    summaryByUser.set(s.user_id, (summaryByUser.get(s.user_id) ?? 0) + s.count);
  }

  for (const userId of userIds) {
    const enrolledCourses = enrolledCoursesByUser.get(userId) ?? new Set<string>();
    let totalModules = 0;
    for (const courseId of enrolledCourses) {
      totalModules += moduleCountByCourse.get(courseId) ?? 0;
    }

    const userProgress = progressByUser.get(userId) ?? [];

    // Only count approvals for modules in courses the member is CURRENTLY
    // enrolled in (AUDIT CRS-7). Counting every approved row against a total
    // drawn only from enrolled courses let `progress` exceed 1 after an
    // unenrollment or an unpublished course, and compositeScore doesn't clamp.
    const approvedModules = userProgress.filter((p) => {
      if (p.status !== "approved") return false;
      const courseId = courseByModule.get(p.module_id);
      // A module whose course we couldn't resolve isn't in an enrolled course.
      return courseId !== undefined && enrolledCourses.has(courseId);
    }).length;

    // Real rejection history, not just outstanding rejections (AUDIT CRS-6).
    // `rejection_note` is cleared on approval, so the old expression scored a
    // member rejected three times and then approved at a perfect 100%.
    const rejections = userProgress.reduce((n, p) => n + (p.rejection_count ?? 0), 0);
    const assignmentsDenom = approvedModules + rejections;

    const counted = (attendanceByUser.get(userId) ?? []).filter(
      (a) => a.status === "present" || a.status === "absent"
    );
    const present = counted.filter((a) => a.status === "present").length;

    // Imported tallies for months inside the window: each counted service is a
    // "present" against an expected service count for that month.
    const importedPresent = summaryByUser.get(userId) ?? 0;
    const importedExpected = importedPresent > 0 ? window.expectedServices : 0;

    const attendancePresent = present + importedPresent;
    const attendanceTotal = counted.length + Math.max(importedExpected, importedPresent);

    const parts: PerformanceParts = {
      progress: totalModules ? Math.min(1, approvedModules / totalModules) : 0,
      assignments: assignmentsDenom ? Math.min(1, approvedModules / assignmentsDenom) : 0,
      attendance: attendanceTotal ? Math.min(1, attendancePresent / attendanceTotal) : 0,
    };

    result.set(userId, {
      parts,
      composite: compositeScore(parts),
      hasAttendanceData: attendanceTotal > 0,
    });
  }

  return result;
}

/**
 * The 'YYYY-MM' periods overlapping the attendance window, plus a rough count
 * of expected services across them (one signal service per week).
 */
function currentAttendanceWindowPeriods(): { periods: string[]; expectedServices: number } {
  const periods = new Set<string>();
  const now = new Date();
  for (let d = 0; d <= ATTENDANCE_WINDOW_WEEKS * 7; d += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
    periods.add(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}`);
  }
  return { periods: [...periods], expectedServices: ATTENDANCE_WINDOW_WEEKS };
}

/**
 * Computes a single member's composite performance parts (Section 14).
 * Thin wrapper over the batched version — prefer `getMemberPerformances` on any
 * page that needs more than one member.
 */
export async function getMemberPerformance(
  supabase: DB,
  userId: string
): Promise<MemberPerformance> {
  const map = await getMemberPerformances(supabase, [userId]);
  return map.get(userId) ?? { ...EMPTY };
}
