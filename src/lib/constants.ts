/** Tunable composite performance weights (Section 14). Must sum to 1. */
export const PERFORMANCE_WEIGHTS = {
  progress: 0.4,
  assignments: 0.3,
  attendance: 0.3,
} as const;

/** Trailing window for attendance rate, in weeks (Section 14). */
export const ATTENDANCE_WINDOW_WEEKS = 8;

/** Default consecutive missed Sundays before a welfare flag (Section 10). */
export const DEFAULT_MISSED_SERVICE_THRESHOLD = 2;

/** COC pass threshold as a fraction of questions correct (Section 6). */
export const COC_PASS_THRESHOLD = 1.0;

/** Number of questions pulled per COC quiz attempt (Section 6). */
export const COC_QUIZ_SIZE = 4;

/** Guidance: warn (don't block) below this many modules per course (Section 8). */
export const MIN_MODULES_GUIDANCE = 7;

/** Upload guardrails (Section 12). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_UPLOAD_EXT = [".xlsx", ".csv"] as const;

/** Anthropic model for attendance parsing (Section 12). Pinned. */
export const ATTENDANCE_PARSE_MODEL = "claude-sonnet-4-6";

export const ROLES = [
  "member",
  "subunit_leader",
  "secretary",
  "welfare",
  "super_admin",
] as const;
export type Role = (typeof ROLES)[number];

export const MEMBER_STATUSES = [
  "active",
  "inactive",
  "traveled",
  "graduated",
  "left",
] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/** Seed subunits (Section 4). Keep slugs stable; used for routing/lookup. */
export const SEED_SUBUNITS = {
  primary: ["Photography", "Projection", "Production", "Social Media", "Utility (Videography & Technical)"],
  secondary: ["Graphic Design", "Video Editing", "Welfare", "Secretary", "Publication"],
} as const;
