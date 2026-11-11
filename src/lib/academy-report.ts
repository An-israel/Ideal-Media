/**
 * Who is doing what in the Skills Academy.
 *
 * A member's progress was visible to nobody but the member, so the department
 * had built an academy it could not see into: no way to tell whether anybody
 * had started a course, let alone finished one. This turns the raw progress
 * rows into the two views that question needs — by course, and by person.
 *
 * Pure on purpose, with the database reads kept in academy-report-queries.ts:
 * the counting rules here ("started" means one step done, "finished" means
 * every lesson AND every assignment) are exactly the kind that drift apart
 * from the course page's if they cannot be tested.
 */

export interface ReportCourse {
  id: string;
  slug: string;
  title: string;
  position: number;
}

export interface ReportInput {
  courses: ReportCourse[];
  /** Every lesson and assignment, as a step belonging to a course. */
  steps: { id: string; courseId: string }[];
  /** A step somebody has done: a ticked lesson or a submitted assignment. */
  done: { userId: string; stepId: string; at: string }[];
  certificates: { userId: string; courseId: string; code: string; issuedAt: string }[];
  /** The people this report covers. Progress by anyone else is ignored. */
  members: { id: string; fullName: string }[];
}

export interface CourseRow extends ReportCourse {
  steps: number;
  /** Members with at least one step done. */
  started: number;
  /** Members with every step done. */
  finished: number;
  certificates: number;
}

export interface MemberCourse {
  courseId: string;
  title: string;
  slug: string;
  done: number;
  total: number;
  percent: number;
  finished: boolean;
  certificateCode: string | null;
}

export interface MemberRow {
  id: string;
  fullName: string;
  courses: MemberCourse[];
  finished: number;
  certificates: number;
  lastActivity: string | null;
}

export interface AcademyReport {
  totals: {
    members: number;
    /** Members who have done at least one step of anything. */
    learning: number;
    finishedCourses: number;
    certificates: number;
  };
  courses: CourseRow[];
  /** Only members with some activity, most recently active first. */
  members: MemberRow[];
  /** Members covered by the report who have not started anything. */
  notStarted: { id: string; fullName: string }[];
}

export function buildAcademyReport(input: ReportInput): AcademyReport {
  const covered = new Map(input.members.map((m) => [m.id, m.fullName]));
  const courseOfStep = new Map(input.steps.map((s) => [s.id, s.courseId]));
  const courseById = new Map(input.courses.map((c) => [c.id, c]));

  const stepsPerCourse = new Map<string, number>();
  for (const s of input.steps) {
    stepsPerCourse.set(s.courseId, (stepsPerCourse.get(s.courseId) ?? 0) + 1);
  }

  // user → course → the distinct steps done. A Set, because a step recorded
  // twice must not count twice and push someone past 100%.
  const progress = new Map<string, Map<string, Set<string>>>();
  const lastActivity = new Map<string, string>();
  for (const d of input.done) {
    if (!covered.has(d.userId)) continue;
    const courseId = courseOfStep.get(d.stepId);
    // A step whose course has since been removed belongs to nothing countable.
    if (!courseId || !courseById.has(courseId)) continue;
    const perCourse = progress.get(d.userId) ?? new Map<string, Set<string>>();
    const set = perCourse.get(courseId) ?? new Set<string>();
    set.add(d.stepId);
    perCourse.set(courseId, set);
    progress.set(d.userId, perCourse);
    if (!lastActivity.has(d.userId) || d.at > lastActivity.get(d.userId)!) {
      lastActivity.set(d.userId, d.at);
    }
  }

  const certOf = new Map<string, string>();
  for (const c of input.certificates) {
    if (covered.has(c.userId)) certOf.set(`${c.userId}:${c.courseId}`, c.code);
  }

  const courseRows = new Map<string, CourseRow>(
    input.courses.map((c) => [
      c.id,
      { ...c, steps: stepsPerCourse.get(c.id) ?? 0, started: 0, finished: 0, certificates: 0 },
    ])
  );

  const members: MemberRow[] = [];
  for (const [userId, perCourse] of progress) {
    const courses: MemberCourse[] = [];
    for (const [courseId, set] of perCourse) {
      const course = courseById.get(courseId)!;
      const total = stepsPerCourse.get(courseId) ?? 0;
      const done = Math.min(set.size, total);
      const finished = total > 0 && done === total;
      const row = courseRows.get(courseId)!;
      row.started += 1;
      if (finished) row.finished += 1;
      courses.push({
        courseId,
        title: course.title,
        slug: course.slug,
        done,
        total,
        percent: total > 0 ? Math.round((done / total) * 100) : 0,
        finished,
        certificateCode: certOf.get(`${userId}:${courseId}`) ?? null,
      });
    }
    courses.sort((a, b) => b.percent - a.percent || a.title.localeCompare(b.title));
    members.push({
      id: userId,
      fullName: covered.get(userId)!,
      courses,
      finished: courses.filter((c) => c.finished).length,
      certificates: courses.filter((c) => c.certificateCode).length,
      lastActivity: lastActivity.get(userId) ?? null,
    });
  }
  members.sort(
    (a, b) =>
      (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "") ||
      a.fullName.localeCompare(b.fullName)
  );

  for (const key of certOf.keys()) {
    const courseId = key.split(":")[1];
    const row = courseRows.get(courseId);
    if (row) row.certificates += 1;
  }

  const active = new Set(members.map((m) => m.id));
  const notStarted = input.members
    .filter((m) => !active.has(m.id))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return {
    totals: {
      members: input.members.length,
      learning: members.length,
      finishedCourses: members.reduce((n, m) => n + m.finished, 0),
      certificates: certOf.size,
    },
    courses: [...courseRows.values()].sort((a, b) => a.position - b.position),
    members,
    notStarted,
  };
}
