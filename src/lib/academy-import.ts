import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/pagination";
import academy from "@/data/academy.json";
import type { AcademyAssignmentKind, AcademyVideos } from "@/lib/database.types";

/**
 * Loading the academy into the database from the file that ships with the app.
 *
 * The course content was supplied as documents, not as something anyone would
 * retype: 22 courses, 88 modules, 264 lessons, 487 videos and 88 assignments.
 * It lives in src/data/academy.json, is imported here, and is applied by a
 * button on the admin page — rather than as a 400KB SQL script to paste into
 * the Supabase editor, which is how the earlier roster work went and was
 * painful every time.
 *
 * Everything is written in BULK — a handful of requests, not one per row. The
 * first version of this walked the tree and wrote a row at a time, which is
 * about 860 sequential round-trips to Supabase: half a minute or more, against
 * a serverless function that is killed long before that. Ten calls finish in
 * about a second.
 *
 * The import is idempotent and keyed on the slug and on position, so running
 * it again updates the courses in place. That matters for a second reason: a
 * member's progress points at lesson and assignment ids, so an import that
 * deleted and recreated rows would wipe everyone's progress every time the
 * content was corrected.
 */

export interface ImportResult {
  courses: { inserted: number; updated: number };
  modules: number;
  lessons: number;
  assignments: number;
  /** Rows removed because they are no longer in the file. */
  removed: { modules: number; lessons: number; assignments: number };
  errors: string[];
}

interface SourceLesson {
  position: number;
  title: string;
  summary?: string;
  practical?: boolean;
  search_query?: string;
  videos?: AcademyVideos;
}

interface SourceModule {
  position: number;
  title: string;
  goal?: string;
  lessons: SourceLesson[];
  assignment?: {
    kind: string;
    title: string;
    instructions: string;
    checklist?: string[];
  };
}

interface SourceCourse {
  slug: string;
  position: number;
  title: string;
  tagline?: string;
  description?: string;
  category: string;
  level: string;
  weeks?: number;
  dual?: boolean;
  outcomes?: string[];
  tools?: { phone?: string; laptop?: string };
  cover?: string;
  modules: SourceModule[];
}

const SOURCE = academy.courses as unknown as SourceCourse[];

/** What the bundled file describes, without touching the database. */
export function academySummary() {
  let modules = 0;
  let lessons = 0;
  let videos = 0;
  let assignments = 0;
  for (const c of SOURCE) {
    modules += c.modules.length;
    for (const m of c.modules) {
      lessons += m.lessons.length;
      if (m.assignment) assignments += 1;
      for (const l of m.lessons) {
        for (const list of Object.values(l.videos ?? {})) videos += list.length;
      }
    }
  }
  return {
    name: academy.academy as string,
    version: academy.version as number,
    courses: SOURCE.length,
    modules,
    lessons,
    videos,
    assignments,
  };
}

function assignmentKind(raw: string): AcademyAssignmentKind {
  // The documents only use these two. Anything else is a content error worth
  // seeing rather than silently coercing.
  if (raw === "self_check" || raw === "link") return raw;
  throw new Error(`unknown assignment kind: ${raw}`);
}

export async function importAcademy(): Promise<ImportResult> {
  const admin = createAdminClient();
  const result: ImportResult = {
    courses: { inserted: 0, updated: 0 },
    modules: 0,
    lessons: 0,
    assignments: 0,
    removed: { modules: 0, lessons: 0, assignments: 0 },
    errors: [],
  };

  // Validate the whole file before writing any of it. A bad assignment kind in
  // the twentieth course should not leave nineteen imported and the rest not.
  for (const c of SOURCE) {
    for (const m of c.modules) {
      if (m.assignment) assignmentKind(m.assignment.kind);
    }
  }

  // ---- courses -------------------------------------------------------------
  const before = await fetchAllRows<{ slug: string }>((from, to) =>
    admin.from("academy_courses").select("slug").range(from, to)
  );
  const knownSlugs = new Set(before.map((c) => c.slug));
  const now = new Date().toISOString();

  const { data: savedCourses, error: courseError } = await admin
    .from("academy_courses")
    .upsert(
      SOURCE.map((c) => ({
        slug: c.slug,
        position: c.position,
        title: c.title,
        tagline: c.tagline ?? null,
        description: c.description ?? null,
        category: c.category,
        level: c.level,
        weeks: c.weeks ?? null,
        dual: c.dual ?? false,
        outcomes: c.outcomes ?? [],
        tools: c.tools ?? {},
        cover_path: c.cover ?? null,
        is_published: true,
        updated_at: now,
      })),
      { onConflict: "slug" }
    )
    .select("id, slug");
  if (courseError) throw new Error(`courses: ${courseError.message}`);

  const courseIdBySlug = new Map((savedCourses ?? []).map((c) => [c.slug, c.id]));
  for (const c of SOURCE) {
    if (!courseIdBySlug.has(c.slug)) {
      result.errors.push(`${c.slug}: the database did not return an id`);
      continue;
    }
    if (knownSlugs.has(c.slug)) result.courses.updated += 1;
    else result.courses.inserted += 1;
  }

  const courseIds = [...courseIdBySlug.values()];
  if (courseIds.length === 0) return result;

  // ---- modules -------------------------------------------------------------
  const moduleRows = SOURCE.flatMap((c) => {
    const courseId = courseIdBySlug.get(c.slug);
    if (!courseId) return [];
    return c.modules.map((m) => ({
      course_id: courseId,
      position: m.position,
      title: m.title,
      goal: m.goal ?? null,
    }));
  });

  const { data: savedModules, error: moduleError } = await admin
    .from("academy_modules")
    .upsert(moduleRows, { onConflict: "course_id,position" })
    .select("id, course_id, position");
  if (moduleError) throw new Error(`modules: ${moduleError.message}`);
  result.modules = savedModules?.length ?? 0;

  const moduleId = new Map(
    (savedModules ?? []).map((m) => [`${m.course_id}:${m.position}`, m.id])
  );

  // ---- lessons -------------------------------------------------------------
  // Built here rather than worked out again later: this loop already knows
  // which module id each lesson belongs to and which positions the file lists.
  const wanted: WantedContent = {
    moduleIds: new Set(moduleId.values()),
    lessonPositions: new Map(),
    withoutAssignment: [],
  };

  const lessonRows = SOURCE.flatMap((c) => {
    const courseId = courseIdBySlug.get(c.slug);
    if (!courseId) return [];
    return c.modules.flatMap((m) => {
      const mid = moduleId.get(`${courseId}:${m.position}`);
      if (!mid) return [];
      wanted.lessonPositions.set(mid, new Set(m.lessons.map((l) => l.position)));
      if (!m.assignment) wanted.withoutAssignment.push(mid);
      return m.lessons.map((l) => ({
        module_id: mid,
        position: l.position,
        title: l.title,
        summary: l.summary ?? null,
        practical: l.practical ?? false,
        search_query: l.search_query ?? null,
        videos: l.videos ?? {},
      }));
    });
  });

  const { data: savedLessons, error: lessonError } = await admin
    .from("academy_lessons")
    .upsert(lessonRows, { onConflict: "module_id,position" })
    .select("id");
  if (lessonError) throw new Error(`lessons: ${lessonError.message}`);
  result.lessons = savedLessons?.length ?? 0;

  // ---- assignments ---------------------------------------------------------
  const assignmentRows = SOURCE.flatMap((c) => {
    const courseId = courseIdBySlug.get(c.slug);
    if (!courseId) return [];
    return c.modules.flatMap((m) => {
      const mid = moduleId.get(`${courseId}:${m.position}`);
      if (!mid || !m.assignment) return [];
      return [
        {
          module_id: mid,
          kind: assignmentKind(m.assignment.kind),
          title: m.assignment.title,
          instructions: m.assignment.instructions,
          checklist: m.assignment.checklist ?? [],
        },
      ];
    });
  });

  const { data: savedAssignments, error: assignmentError } = await admin
    .from("academy_assignments")
    .upsert(assignmentRows, { onConflict: "module_id" })
    .select("id");
  if (assignmentError) throw new Error(`assignments: ${assignmentError.message}`);
  result.assignments = savedAssignments?.length ?? 0;

  await removeStale(admin, courseIds, wanted, result);
  return result;
}

/** What the file says each surviving module should contain. */
interface WantedContent {
  /** Module ids this import wrote, so anything else under these courses is stale. */
  moduleIds: Set<string>;
  /** Lesson positions the file still lists, per module id. */
  lessonPositions: Map<string, Set<number>>;
  /** Module ids the file gives no assignment. */
  withoutAssignment: string[];
}

/**
 * Takes out content that has gone from the file.
 *
 * Only ever rows under the courses this import just wrote, so a course someone
 * added by hand in the dashboard is left alone rather than treated as stale.
 */
async function removeStale(
  admin: ReturnType<typeof createAdminClient>,
  courseIds: string[],
  wanted: WantedContent,
  result: ImportResult
) {
  const existingModules = await fetchAllRows<{ id: string }>((from, to) =>
    admin.from("academy_modules").select("id").in("course_id", courseIds).range(from, to)
  );
  const staleModules = existingModules
    .filter((m) => !wanted.moduleIds.has(m.id))
    .map((m) => m.id);
  if (staleModules.length > 0) {
    // Lessons and that module's assignment go with it by cascade.
    const { error } = await admin.from("academy_modules").delete().in("id", staleModules);
    if (error) throw new Error(`removing modules: ${error.message}`);
    result.removed.modules += staleModules.length;
  }

  const liveModuleIds = [...wanted.moduleIds];
  if (liveModuleIds.length === 0) return;

  // A lesson whose position is no longer in the file: the module stays, the
  // lesson does not.
  const existingLessons = await fetchAllRows<{
    id: string;
    module_id: string;
    position: number;
  }>((from, to) =>
    admin
      .from("academy_lessons")
      .select("id, module_id, position")
      .in("module_id", liveModuleIds)
      .range(from, to)
  );
  const staleLessons = existingLessons
    .filter((l) => !wanted.lessonPositions.get(l.module_id)?.has(l.position))
    .map((l) => l.id);
  if (staleLessons.length > 0) {
    const { error } = await admin.from("academy_lessons").delete().in("id", staleLessons);
    if (error) throw new Error(`removing lessons: ${error.message}`);
    result.removed.lessons += staleLessons.length;
  }

  // An assignment on a module the file no longer gives one.
  if (wanted.withoutAssignment.length > 0) {
    const { data, error } = await admin
      .from("academy_assignments")
      .delete()
      .in("module_id", wanted.withoutAssignment)
      .select("id");
    if (error) throw new Error(`removing assignments: ${error.message}`);
    result.removed.assignments += data?.length ?? 0;
  }
}
