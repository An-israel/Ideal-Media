import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/pagination";
import type {
  AcademyAssignment,
  AcademyLesson,
  AcademyModule,
  AcademyCourse,
} from "@/lib/database.types";
import type { ModuleWithContent, CourseWithContent } from "@/lib/academy-content";

export type {
  LessonWithProgress,
  ModuleWithContent,
  CourseWithContent,
} from "@/lib/academy-content";
export { videosFor, isDualLesson } from "@/lib/academy-content";

/**
 * Reading the Skills Academy.
 *
 * Content is the same for everybody, so it is read with the admin client and
 * composed here; what differs per member — which lessons they have ticked,
 * what they have submitted — is read separately and joined in memory. That
 * keeps one course page to a handful of queries instead of one per module.
 */

/** Published course rows for the academy index, in the academy's own order. */
export async function listCourses(): Promise<AcademyCourse[]> {
  const admin = createAdminClient();
  return fetchAllRows<AcademyCourse>((from, to) =>
    admin
      .from("academy_courses")
      .select("*")
      .eq("is_published", true)
      .order("position")
      .range(from, to)
  );
}

/** How far a member is through every course they have started. */
export async function courseProgressFor(
  userId: string
): Promise<Map<string, { done: number; total: number; complete: boolean }>> {
  const admin = createAdminClient();

  const [lessons, done, assignments, submissions] = await Promise.all([
    fetchAllRows<{ id: string; module_id: string }>((from, to) =>
      admin.from("academy_lessons").select("id, module_id").range(from, to)
    ),
    fetchAllRows<{ lesson_id: string }>((from, to) =>
      admin
        .from("academy_lesson_progress")
        .select("lesson_id")
        .eq("user_id", userId)
        .range(from, to)
    ),
    fetchAllRows<{ id: string; module_id: string }>((from, to) =>
      admin.from("academy_assignments").select("id, module_id").range(from, to)
    ),
    fetchAllRows<{ assignment_id: string }>((from, to) =>
      admin
        .from("academy_submissions")
        .select("assignment_id")
        .eq("user_id", userId)
        .range(from, to)
    ),
  ]);

  const modules = await fetchAllRows<{ id: string; course_id: string }>((from, to) =>
    admin.from("academy_modules").select("id, course_id").range(from, to)
  );
  const courseOfModule = new Map(modules.map((m) => [m.id, m.course_id]));
  const doneLessons = new Set(done.map((d) => d.lesson_id));
  const submitted = new Set(submissions.map((s) => s.assignment_id));

  const out = new Map<string, { done: number; total: number; complete: boolean }>();
  const bump = (courseId: string, total: number, isDone: boolean) => {
    const cur = out.get(courseId) ?? { done: 0, total: 0, complete: false };
    cur.total += total;
    cur.done += isDone ? 1 : 0;
    out.set(courseId, cur);
  };

  for (const l of lessons) {
    const courseId = courseOfModule.get(l.module_id);
    if (courseId) bump(courseId, 1, doneLessons.has(l.id));
  }
  // An assignment counts towards the bar as well, so a member who has watched
  // everything but submitted nothing does not read as finished.
  for (const a of assignments) {
    const courseId = courseOfModule.get(a.module_id);
    if (courseId) bump(courseId, 1, submitted.has(a.id));
  }
  for (const [, v] of out) v.complete = v.total > 0 && v.done === v.total;
  return out;
}

/** One course with its modules, lessons, assignments and this member's progress. */
export async function getCourse(
  slug: string,
  userId: string
): Promise<CourseWithContent | null> {
  const admin = createAdminClient();
  const { data: course } = await admin
    .from("academy_courses")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (!course) return null;

  const modules = await fetchAllRows<AcademyModule>((from, to) =>
    admin
      .from("academy_modules")
      .select("*")
      .eq("course_id", course.id)
      .order("position")
      .range(from, to)
  );
  const moduleIds = modules.map((m) => m.id);
  if (moduleIds.length === 0) {
    return { ...course, modules: [], lessonsTotal: 0, lessonsDone: 0, complete: false };
  }

  const [lessons, assignments] = await Promise.all([
    fetchAllRows<AcademyLesson>((from, to) =>
      admin
        .from("academy_lessons")
        .select("*")
        .in("module_id", moduleIds)
        .order("position")
        .range(from, to)
    ),
    fetchAllRows<AcademyAssignment>((from, to) =>
      admin.from("academy_assignments").select("*").in("module_id", moduleIds).range(from, to)
    ),
  ]);

  const lessonIds = lessons.map((l) => l.id);
  const assignmentIds = assignments.map((a) => a.id);
  const [progress, submissions] = await Promise.all([
    lessonIds.length
      ? fetchAllRows<{ lesson_id: string }>((from, to) =>
          admin
            .from("academy_lesson_progress")
            .select("lesson_id")
            .eq("user_id", userId)
            .in("lesson_id", lessonIds)
            .range(from, to)
        )
      : Promise.resolve([]),
    assignmentIds.length
      ? fetchAllRows<{
          assignment_id: string;
          link: string | null;
          checked: number[];
          submitted_at: string;
        }>((from, to) =>
          admin
            .from("academy_submissions")
            .select("assignment_id, link, checked, submitted_at")
            .eq("user_id", userId)
            .in("assignment_id", assignmentIds)
            .range(from, to)
        )
      : Promise.resolve([]),
  ]);

  const doneLessons = new Set(progress.map((p) => p.lesson_id));
  const submissionOf = new Map(submissions.map((s) => [s.assignment_id, s]));
  const assignmentOf = new Map(assignments.map((a) => [a.module_id, a]));

  let lessonsTotal = 0;
  let lessonsDone = 0;
  const withContent: ModuleWithContent[] = modules.map((m) => {
    const own = lessons
      .filter((l) => l.module_id === m.id)
      .map((l) => ({ ...l, done: doneLessons.has(l.id) }));
    lessonsTotal += own.length;
    lessonsDone += own.filter((l) => l.done).length;

    const assignment = assignmentOf.get(m.id) ?? null;
    const sub = assignment ? submissionOf.get(assignment.id) : undefined;
    return {
      ...m,
      lessons: own,
      assignment,
      submission: sub
        ? { link: sub.link, checked: sub.checked ?? [], submittedAt: sub.submitted_at }
        : null,
      complete: own.every((l) => l.done) && (!assignment || !!sub),
    };
  });

  return {
    ...course,
    modules: withContent,
    lessonsTotal,
    lessonsDone,
    complete: withContent.length > 0 && withContent.every((m) => m.complete),
  };
}
