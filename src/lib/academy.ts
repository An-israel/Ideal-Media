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

export interface AcademySummary {
  /** Published courses on offer. */
  available: number;
  started: number;
  finished: number;
  /** The unfinished course they touched most recently, to pick back up. */
  resume: { slug: string; title: string; done: number; total: number } | null;
}

/**
 * The dashboard's view of a member's academy progress.
 *
 * Returns null instead of throwing, whatever goes wrong. This runs on the
 * dashboard — the first page everybody lands on — and the academy tables arrive
 * with their own migration. A site that redirected every member to the wrong
 * page because one newer column was missing is the reason nothing on the
 * dashboard is allowed to depend on the newest feature being installed.
 */
export async function getAcademySummary(userId: string): Promise<AcademySummary | null> {
  try {
    const admin = createAdminClient();
    const [courses, progress] = await Promise.all([listCourses(), courseProgressFor(userId)]);
    if (courses.length === 0) return null;

    const inProgress = courses.filter((c) => {
      const p = progress.get(c.id);
      return p && p.done > 0 && !p.complete;
    });

    let resume: AcademySummary["resume"] = null;
    if (inProgress.length > 0) {
      // Most recently ticked lesson decides which course "continue" means.
      const { data: latest } = await admin
        .from("academy_lesson_progress")
        .select("lesson_id")
        .eq("user_id", userId)
        .order("completed_at", { ascending: false })
        .limit(25);
      const lessonIds = (latest ?? []).map((l) => l.lesson_id);
      let pick = inProgress[0];
      if (lessonIds.length > 0) {
        const { data: lessons } = await admin
          .from("academy_lessons")
          .select("id, module_id")
          .in("id", lessonIds);
        const moduleIds = [...new Set((lessons ?? []).map((l) => l.module_id))];
        const { data: modules } = moduleIds.length
          ? await admin.from("academy_modules").select("id, course_id").in("id", moduleIds)
          : { data: [] as { id: string; course_id: string }[] };
        const moduleOf = new Map((lessons ?? []).map((l) => [l.id, l.module_id]));
        const courseOf = new Map((modules ?? []).map((m) => [m.id, m.course_id]));
        const open = new Map(inProgress.map((c) => [c.id, c]));
        for (const id of lessonIds) {
          const course = open.get(courseOf.get(moduleOf.get(id) ?? "") ?? "");
          if (course) {
            pick = course;
            break;
          }
        }
      }
      const p = progress.get(pick.id)!;
      resume = { slug: pick.slug, title: pick.title, done: p.done, total: p.total };
    }

    return {
      available: courses.length,
      started: courses.filter((c) => (progress.get(c.id)?.done ?? 0) > 0).length,
      finished: courses.filter((c) => progress.get(c.id)?.complete).length,
      resume,
    };
  } catch (e) {
    console.error("[academy] dashboard summary unavailable:", e);
    return null;
  }
}
