import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/pagination";
import { buildAcademyReport, type AcademyReport } from "@/lib/academy-report";

/**
 * Loads the academy report for a set of members.
 *
 * `subunitIds` narrows it to the members of those subunits — that is what a
 * subunit leader sees. Left out, it covers the whole department, for the super
 * admin and the secretary. The narrowing happens here on the server, from the
 * caller's session; nothing the browser sends chooses whose progress is shown.
 */
export async function getAcademyReport(subunitIds?: string[]): Promise<AcademyReport> {
  const admin = createAdminClient();

  let scope: Set<string> | null = null;
  if (subunitIds) {
    if (subunitIds.length === 0) scope = new Set();
    else {
      const rows = await fetchAllRows<{ user_id: string }>((from, to) =>
        admin
          .from("subunit_members")
          .select("user_id")
          .in("subunit_id", subunitIds)
          .range(from, to)
      );
      scope = new Set(rows.map((r) => r.user_id));
    }
  }

  const [profiles, courses, modules, lessons, assignments, progress, submissions, certificates] =
    await Promise.all([
      fetchAllRows<{
        id: string;
        full_name: string;
        member_status: string;
        access_revoked_at: string | null;
      }>((from, to) =>
        admin
          .from("profiles")
          .select("id, full_name, member_status, access_revoked_at")
          .order("id")
          .range(from, to)
      ),
      fetchAllRows<{ id: string; slug: string; title: string; position: number }>((from, to) =>
        admin
          .from("academy_courses")
          .select("id, slug, title, position")
          .eq("is_published", true)
          .range(from, to)
      ),
      fetchAllRows<{ id: string; course_id: string }>((from, to) =>
        admin.from("academy_modules").select("id, course_id").range(from, to)
      ),
      fetchAllRows<{ id: string; module_id: string }>((from, to) =>
        admin.from("academy_lessons").select("id, module_id").range(from, to)
      ),
      fetchAllRows<{ id: string; module_id: string }>((from, to) =>
        admin.from("academy_assignments").select("id, module_id").range(from, to)
      ),
      fetchAllRows<{ user_id: string; lesson_id: string; completed_at: string }>((from, to) =>
        admin
          .from("academy_lesson_progress")
          .select("user_id, lesson_id, completed_at")
          .order("id")
          .range(from, to)
      ),
      fetchAllRows<{ user_id: string; assignment_id: string; submitted_at: string }>((from, to) =>
        admin
          .from("academy_submissions")
          .select("user_id, assignment_id, submitted_at")
          .order("id")
          .range(from, to)
      ),
      fetchAllRows<{ user_id: string; course_id: string; code: string; issued_at: string }>(
        (from, to) =>
          admin
            .from("academy_certificates")
            .select("user_id, course_id, code, issued_at")
            .order("id")
            .range(from, to)
      ),
    ]);

  const courseOfModule = new Map(modules.map((m) => [m.id, m.course_id]));
  const steps = [
    ...lessons.map((l) => ({ id: l.id, courseId: courseOfModule.get(l.module_id) ?? "" })),
    ...assignments.map((a) => ({ id: a.id, courseId: courseOfModule.get(a.module_id) ?? "" })),
  ].filter((s) => s.courseId);

  // The people still on the roll, and inside the caller's scope.
  const members = profiles
    .filter(
      (p) =>
        p.access_revoked_at === null &&
        !["left", "graduated"].includes(p.member_status) &&
        (scope === null || scope.has(p.id))
    )
    .map((p) => ({ id: p.id, fullName: p.full_name }));

  return buildAcademyReport({
    courses,
    steps,
    done: [
      ...progress.map((p) => ({ userId: p.user_id, stepId: p.lesson_id, at: p.completed_at })),
      ...submissions.map((s) => ({
        userId: s.user_id,
        stepId: s.assignment_id,
        at: s.submitted_at,
      })),
    ],
    certificates: certificates.map((c) => ({
      userId: c.user_id,
      courseId: c.course_id,
      code: c.code,
      issuedAt: c.issued_at,
    })),
    members,
  });
}
