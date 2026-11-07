import { describe, it, expect, vi, beforeEach } from "vitest";
import { academyTables, type FakeSupabase } from "./__fixtures__/fake-supabase";

let db: FakeSupabase;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => db,
}));

const { importAcademy, academySummary } = await import("./academy-import");

beforeEach(() => {
  db = academyTables();
});

describe("academySummary", () => {
  it("counts what the shipped file holds", () => {
    const s = academySummary();
    expect(s.courses).toBe(22);
    expect(s.modules).toBe(88);
    expect(s.lessons).toBe(264);
    expect(s.assignments).toBe(88);
    expect(s.videos).toBeGreaterThan(400);
  });
});

describe("importAcademy", () => {
  it("writes every course, module, lesson and assignment", async () => {
    const r = await importAcademy();

    expect(r.errors).toEqual([]);
    expect(r.courses).toEqual({ inserted: 22, updated: 0 });
    expect(r.modules).toBe(88);
    expect(r.lessons).toBe(264);
    expect(r.assignments).toBe(88);
    expect(db.rows("academy_courses")).toHaveLength(22);
    expect(db.rows("academy_modules")).toHaveLength(88);
    expect(db.rows("academy_lessons")).toHaveLength(264);
    expect(db.rows("academy_assignments")).toHaveLength(88);
  });

  it("stays within a handful of requests", async () => {
    // The first version made one request per row — about 860 of them, which is
    // far longer than a serverless function is allowed to run. This is the
    // regression guard for that.
    await importAcademy();
    expect(db.calls.length).toBeLessThan(15);
  });

  it("hangs every lesson off the right module", async () => {
    await importAcademy();
    const course = db.rows("academy_courses").find((c) => c.slug === "graphic-design")!;
    const modules = db
      .rows("academy_modules")
      .filter((m) => m.course_id === course.id)
      .sort((a, b) => (a.position as number) - (b.position as number));
    expect(modules.map((m) => m.title)).toEqual([
      "Design Foundations",
      "Canva on Phone and Laptop",
      "Photo Editing and Composition",
      "Logos and Brand Basics",
    ]);

    const first = db
      .rows("academy_lessons")
      .filter((l) => l.module_id === modules[0].id)
      .sort((a, b) => (a.position as number) - (b.position as number));
    expect(first.map((l) => l.title)).toEqual([
      "The elements of design",
      "The principles of design",
      "Colour theory",
    ]);

    const assignment = db
      .rows("academy_assignments")
      .find((a) => a.module_id === modules[0].id)!;
    expect(assignment.kind).toBe("self_check");
    expect(assignment.checklist).toHaveLength(3);
  });

  it("re-importing changes nothing and keeps every id", async () => {
    // Progress and certificates point at these ids. An import that recreated
    // rows would wipe everyone's progress each time the content was corrected.
    await importAcademy();
    const lessonIds = db.rows("academy_lessons").map((l) => l.id).sort();
    const courseIds = db.rows("academy_courses").map((c) => c.id).sort();

    const again = await importAcademy();

    expect(again.courses).toEqual({ inserted: 0, updated: 22 });
    expect(again.removed).toEqual({ modules: 0, lessons: 0, assignments: 0 });
    expect(db.rows("academy_lessons").map((l) => l.id).sort()).toEqual(lessonIds);
    expect(db.rows("academy_courses").map((c) => c.id).sort()).toEqual(courseIds);
    expect(db.rows("academy_lessons")).toHaveLength(264);
  });

  it("corrects content in place rather than duplicating it", async () => {
    await importAcademy();
    const lesson = db.rows("academy_lessons").find((l) => l.title === "Colour theory")!;
    lesson.title = "stale title";
    lesson.summary = "stale summary";

    await importAcademy();

    const after = db.rows("academy_lessons").filter((l) => l.id === lesson.id);
    expect(after).toHaveLength(1);
    expect(after[0].title).toBe("Colour theory");
    expect(db.rows("academy_lessons")).toHaveLength(264);
  });

  it("removes content that has gone from the file, and nothing else", async () => {
    await importAcademy();
    const course = db.rows("academy_courses").find((c) => c.slug === "graphic-design")!;
    const modules = db.rows("academy_modules").filter((m) => m.course_id === course.id);

    // A module, a lesson and an assignment that the file does not describe.
    db.rows("academy_modules").push({
      id: "ghost-module",
      course_id: course.id,
      position: 99,
      title: "Ghost",
    });
    db.rows("academy_lessons").push({
      id: "ghost-lesson",
      module_id: modules[0].id,
      position: 99,
      title: "Ghost lesson",
    });

    const r = await importAcademy();

    expect(r.removed.modules).toBe(1);
    expect(r.removed.lessons).toBe(1);
    expect(db.rows("academy_modules").some((m) => m.id === "ghost-module")).toBe(false);
    expect(db.rows("academy_lessons").some((l) => l.id === "ghost-lesson")).toBe(false);
    // The real content is untouched.
    expect(db.rows("academy_modules")).toHaveLength(88);
    expect(db.rows("academy_lessons")).toHaveLength(264);
  });

  it("leaves a course nobody imported alone", async () => {
    // Someone may add a course by hand. Stale-removal is scoped to the courses
    // this import wrote, so that one must survive with its modules.
    db.rows("academy_courses").push({
      id: "handmade",
      slug: "made-by-hand",
      position: 50,
      title: "Made by hand",
      category: "Test",
      level: "Beginner",
    });
    db.rows("academy_modules").push({
      id: "handmade-module",
      course_id: "handmade",
      position: 1,
      title: "Its module",
    });

    const r = await importAcademy();

    expect(r.removed.modules).toBe(0);
    expect(db.rows("academy_courses").some((c) => c.slug === "made-by-hand")).toBe(true);
    expect(db.rows("academy_modules").some((m) => m.id === "handmade-module")).toBe(true);
  });
});
