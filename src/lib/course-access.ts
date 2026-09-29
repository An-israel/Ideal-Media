import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/phone";
import type { Database } from "@/lib/database.types";

export interface CourseInstructor {
  id: string;
  full_name: string;
  whatsapp_number: string | null;
  /** True when the stored number can actually be turned into a wa.me link. */
  reachableOnWhatsApp: boolean;
  /**
   * How we arrived at this person:
   *   'instructor' — the course's named instructor (the normal case)
   *   'creator'    — no instructor set, so the person who created it
   *   'fallback'   — neither is available, so a leader of the subunit
   */
  source: "instructor" | "creator" | "fallback";
}

/**
 * Resolves the person who receives assignment submissions for a course.
 *
 * `courses.instructor_id` is the answer whenever it's set — it is an explicit,
 * editable field precisely because a course outlives whoever first clicked
 * "create". The old version inferred the contact (course author *if* they
 * happened to lead the subunit, otherwise the subunit's longest-standing
 * leader), which meant nobody could see or change who submissions went to.
 *
 * Uses the admin client because a regular member cannot read a leader's profile
 * under RLS.
 */
export async function resolveCourseInstructor(
  courseId: string
): Promise<CourseInstructor | null> {
  const admin = createAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select("subunit_id, created_by, instructor_id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return null;

  const load = async (
    id: string,
    source: CourseInstructor["source"]
  ): Promise<CourseInstructor | null> => {
    const { data: profile } = await admin
      .from("profiles")
      .select("id, full_name, whatsapp_number")
      .eq("id", id)
      .maybeSingle();
    if (!profile) return null;
    return {
      ...profile,
      reachableOnWhatsApp: normalizePhone(profile.whatsapp_number) !== null,
      source,
    };
  };

  if (course.instructor_id) {
    const named = await load(course.instructor_id, "instructor");
    if (named) return named;
  }
  if (course.created_by) {
    const creator = await load(course.created_by, "creator");
    if (creator) return creator;
  }

  // Both accounts are gone — fall back to a leader of the subunit so the course
  // still has somebody attached, ordered so the pick is stable.
  const { data: leaders } = await admin
    .from("subunit_members")
    .select("user_id")
    .eq("subunit_id", course.subunit_id)
    .eq("role_in_subunit", "leader")
    .order("created_at", { ascending: true })
    .limit(1);

  const fallbackId = leaders?.[0]?.user_id;
  return fallbackId ? load(fallbackId, "fallback") : null;
}

export interface CourseInstructorSummary {
  courseId: string;
  instructorId: string | null;
  instructorName: string | null;
  hasWhatsApp: boolean;
}

/**
 * Instructor name + contact status for every course the CALLER can see, in one
 * query.
 *
 * Members can't read a leader's profile row, so this goes through the
 * `course_instructors()` definer function, which exposes only the name and
 * whether a number exists — never the number itself. Use this for list pages
 * rather than calling resolveCourseInstructor per card.
 *
 * Takes the caller's own client on purpose: the function filters by
 * `course_visible()`, which reads `auth.uid()`. Passing the service-role client
 * would return no rows (no auth.uid()), and removing the filter would let any
 * member enumerate every course and instructor in the system.
 */
export async function getCourseInstructors(
  supabase: SupabaseClient<Database>
): Promise<Map<string, CourseInstructorSummary>> {
  const { data, error } = await supabase.rpc("course_instructors");
  if (error) {
    console.error("[courses] could not load instructors:", error.message);
    return new Map();
  }
  return new Map(
    (data ?? []).map((r) => [
      r.course_id,
      {
        courseId: r.course_id,
        instructorId: r.instructor_id,
        instructorName: r.instructor_name,
        hasWhatsApp: r.has_whatsapp ?? false,
      },
    ])
  );
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
