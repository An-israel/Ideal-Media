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

/** What the bundled file describes, without touching the database. */
export function academySummary() {
  const courses = academy.courses as unknown as SourceCourse[];
  let modules = 0;
  let lessons = 0;
  let videos = 0;
  let assignments = 0;
  for (const c of courses) {
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
    courses: courses.length,
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
  const courses = academy.courses as unknown as SourceCourse[];
  const result: ImportResult = {
    courses: { inserted: 0, updated: 0 },
    modules: 0,
    lessons: 0,
    assignments: 0,
    removed: { modules: 0, lessons: 0, assignments: 0 },
    errors: [],
  };

  const existing = await fetchAllRows<{ id: string; slug: string }>((from, to) =>
    admin.from("academy_courses").select("id, slug").range(from, to)
  );
  const courseIdBySlug = new Map(existing.map((c) => [c.slug, c.id]));

  for (const c of courses) {
    try {
      const row = {
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
        updated_at: new Date().toISOString(),
      };

      const known = courseIdBySlug.get(c.slug);
      let courseId: string;
      if (known) {
        const { error } = await admin.from("academy_courses").update(row).eq("id", known);
        if (error) throw new Error(error.message);
        courseId = known;
        result.courses.updated += 1;
      } else {
        const { data, error } = await admin
          .from("academy_courses")
          .insert(row)
          .select("id")
          .single();
        if (error || !data) throw new Error(error?.message ?? "insert returned no row");
        courseId = data.id;
        result.courses.inserted += 1;
      }

      await importModules(admin, courseId, c, result);
    } catch (e) {
      result.errors.push(`${c.slug}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}

async function importModules(
  admin: ReturnType<typeof createAdminClient>,
  courseId: string,
  course: SourceCourse,
  result: ImportResult
) {
  const existingModules = await fetchAllRows<{ id: string; position: number }>((from, to) =>
    admin.from("academy_modules").select("id, position").eq("course_id", courseId).range(from, to)
  );
  const moduleIdByPosition = new Map(existingModules.map((m) => [m.position, m.id]));

  for (const m of course.modules) {
    const row = { course_id: courseId, position: m.position, title: m.title, goal: m.goal ?? null };
    let moduleId = moduleIdByPosition.get(m.position);
    if (moduleId) {
      const { error } = await admin.from("academy_modules").update(row).eq("id", moduleId);
      if (error) throw new Error(`module ${m.position}: ${error.message}`);
    } else {
      const { data, error } = await admin
        .from("academy_modules")
        .insert(row)
        .select("id")
        .single();
      if (error || !data) throw new Error(`module ${m.position}: ${error?.message ?? "no row"}`);
      moduleId = data.id;
    }
    result.modules += 1;

    await importLessons(admin, moduleId, m, result);
    await importAssignment(admin, moduleId, m, result);
  }

  // A module that has gone from the file goes from the database, taking its
  // lessons and assignment with it by cascade.
  const wanted = new Set(course.modules.map((m) => m.position));
  const stale = existingModules.filter((m) => !wanted.has(m.position)).map((m) => m.id);
  if (stale.length > 0) {
    const { error } = await admin.from("academy_modules").delete().in("id", stale);
    if (error) throw new Error(`removing modules: ${error.message}`);
    result.removed.modules += stale.length;
  }
}

async function importLessons(
  admin: ReturnType<typeof createAdminClient>,
  moduleId: string,
  m: SourceModule,
  result: ImportResult
) {
  const existing = await fetchAllRows<{ id: string; position: number }>((from, to) =>
    admin.from("academy_lessons").select("id, position").eq("module_id", moduleId).range(from, to)
  );
  const byPosition = new Map(existing.map((l) => [l.position, l.id]));

  for (const l of m.lessons) {
    const row = {
      module_id: moduleId,
      position: l.position,
      title: l.title,
      summary: l.summary ?? null,
      practical: l.practical ?? false,
      search_query: l.search_query ?? null,
      videos: l.videos ?? {},
    };
    const known = byPosition.get(l.position);
    const { error } = known
      ? await admin.from("academy_lessons").update(row).eq("id", known)
      : await admin.from("academy_lessons").insert(row);
    if (error) throw new Error(`lesson ${m.position}.${l.position}: ${error.message}`);
    result.lessons += 1;
  }

  const wanted = new Set(m.lessons.map((l) => l.position));
  const stale = existing.filter((l) => !wanted.has(l.position)).map((l) => l.id);
  if (stale.length > 0) {
    const { error } = await admin.from("academy_lessons").delete().in("id", stale);
    if (error) throw new Error(`removing lessons: ${error.message}`);
    result.removed.lessons += stale.length;
  }
}

async function importAssignment(
  admin: ReturnType<typeof createAdminClient>,
  moduleId: string,
  m: SourceModule,
  result: ImportResult
) {
  const { data: existing } = await admin
    .from("academy_assignments")
    .select("id")
    .eq("module_id", moduleId)
    .maybeSingle();

  if (!m.assignment) {
    if (existing) {
      await admin.from("academy_assignments").delete().eq("id", existing.id);
      result.removed.assignments += 1;
    }
    return;
  }

  const row = {
    module_id: moduleId,
    kind: assignmentKind(m.assignment.kind),
    title: m.assignment.title,
    instructions: m.assignment.instructions,
    checklist: m.assignment.checklist ?? [],
  };
  const { error } = existing
    ? await admin.from("academy_assignments").update(row).eq("id", existing.id)
    : await admin.from("academy_assignments").insert(row);
  if (error) throw new Error(`assignment ${m.position}: ${error.message}`);
  result.assignments += 1;
}
