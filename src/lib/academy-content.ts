import type {
  AcademyAssignment,
  AcademyLesson,
  AcademyModule,
  AcademyCourse,
  AcademyVideo,
  AcademyVideos,
} from "@/lib/database.types";

/**
 * The shapes a course page works with, and the rules that are pure functions
 * of them.
 *
 * Deliberately free of `server-only`: the lesson list is an interactive client
 * component (watch, tick, submit), and it needs these same types and the same
 * answer to "which video does this device get". Keeping them here is what stops
 * that rule being written twice and drifting.
 */

export interface LessonWithProgress extends AcademyLesson {
  done: boolean;
}

export interface ModuleWithContent extends AcademyModule {
  lessons: LessonWithProgress[];
  assignment: AcademyAssignment | null;
  submission: { link: string | null; checked: number[]; submittedAt: string } | null;
  /** Every lesson ticked and the assignment submitted. */
  complete: boolean;
}

export interface CourseWithContent extends AcademyCourse {
  modules: ModuleWithContent[];
  lessonsTotal: number;
  lessonsDone: number;
  complete: boolean;
}

/**
 * The videos to show for a lesson on a given device.
 *
 * A lesson either has one list for everybody or one per device. Asking for
 * "phone" on a lesson that only has "any" must still return the video rather
 * than an empty player, which is why this is a function and not a lookup.
 */
export function videosFor(videos: AcademyVideos, device: "phone" | "laptop"): AcademyVideo[] {
  const forDevice = videos[device];
  if (forDevice && forDevice.length > 0) return forDevice;
  if (videos.any && videos.any.length > 0) return videos.any;
  // Falling back to whatever exists beats showing nothing.
  return videos.phone ?? videos.laptop ?? [];
}

/** True when the lesson actually differs by device. */
export function isDualLesson(videos: AcademyVideos): boolean {
  return (videos.phone?.length ?? 0) > 0 && (videos.laptop?.length ?? 0) > 0;
}

/**
 * Whether a course has anything for a phone/laptop switch to switch between.
 *
 * NOT the course's `dual` flag. That is a claim about equipment — Cinematography
 * is marked dual because you can shoot it on a phone camera or a proper one —
 * and three of the courses carry it while every one of their lessons has a
 * single video for everybody. Reading the flag would put a toggle on those
 * pages that changes nothing when pressed, so the toggle is decided by the
 * lessons that are actually there.
 */
export function hasDeviceSplit(modules: ModuleWithContent[]): boolean {
  return modules.some((m) => m.lessons.some((l) => isDualLesson(l.videos)));
}
