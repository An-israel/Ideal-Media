import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface CourseLeader {
  id: string;
  full_name: string;
  whatsapp_number: string | null;
}

/**
 * Resolves the designated leader for a course's subunit (Section 7): the course
 * owner if they lead the subunit, otherwise the subunit's lead. Uses the admin
 * client because a regular member cannot read a leader's profile under RLS.
 */
export async function resolveCourseLeader(courseId: string): Promise<CourseLeader | null> {
  const admin = createAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select("subunit_id, created_by")
    .eq("id", courseId)
    .single();
  if (!course) return null;

  const { data: leaders } = await admin
    .from("subunit_members")
    .select("user_id")
    .eq("subunit_id", course.subunit_id)
    .eq("role_in_subunit", "leader");

  const leaderIds = (leaders ?? []).map((l) => l.user_id);
  if (leaderIds.length === 0) return null;

  const targetId = leaderIds.includes(course.created_by) ? course.created_by : leaderIds[0];

  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name, whatsapp_number")
    .eq("id", targetId)
    .single();

  return profile ?? null;
}

/** Enrolls every primary member of a subunit into a (primary) course. */
export async function autoEnrollPrimaryMembers(courseId: string, subunitId: string) {
  const admin = createAdminClient();
  const { data: members } = await admin
    .from("subunit_members")
    .select("user_id")
    .eq("subunit_id", subunitId)
    .eq("membership_type", "primary");

  const rows = (members ?? []).map((m) => ({
    user_id: m.user_id,
    course_id: courseId,
    status: "enrolled" as const,
  }));
  if (rows.length === 0) return;

  // Ignore conflicts on the (user_id, course_id) unique index.
  await admin.from("enrollments").upsert(rows, {
    onConflict: "user_id,course_id",
    ignoreDuplicates: true,
  });
}
