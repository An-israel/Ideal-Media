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

/**
 * COC attempt rate limit. The quiz is 100%-to-pass from a small bank with
 * reshuffled options, so unlimited retries are themselves a bypass.
 */
export const COC_MAX_ATTEMPTS_PER_WINDOW = 5;
export const COC_ATTEMPT_WINDOW_MINUTES = 15;

/** Guidance: warn (don't block) below this many modules per course (Section 8). */
export const MIN_MODULES_GUIDANCE = 7;

/** Upload guardrails (Section 12). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_UPLOAD_EXT = [".xlsx", ".csv"] as const;

/**
 * Anthropic model for attendance parsing and column mapping (Section 12).
 * Pinned deliberately so parsing behaviour only changes when we change it.
 *
 * Sonnet 5 supersedes the previous pin (Sonnet 4.6) and is both cheaper
 * ($2/$10 vs $3/$15 per MTok) and more capable.
 */
export const ATTENDANCE_PARSE_MODEL = "claude-sonnet-5";

/**
 * Model for reading a PHOTO of a handwritten register. Vision on messy
 * handwriting is the hardest call we make and the one a human has to correct
 * by hand, so it runs on the stronger model.
 */
export const ATTENDANCE_VISION_MODEL = "claude-opus-5";

/**
 * Max members sent to the parser in one request. The whole roster used to go
 * into a single prompt with an 8k output cap, so a large team silently
 * truncated the tool response mid-JSON (AUDIT ATT-3).
 */
export const PARSE_ROSTER_CHUNK = 120;

/** Output cap per parse request. Generous — the matches array is the bulk. */
export const PARSE_MAX_TOKENS = 16000;

/**
 * Page size for paginated reads. PostgREST caps an unbounded select() at 1000
 * rows and returns no error, so anything that must see every row pages through
 * with this (AUDIT PERF-2).
 */
export const PAGE_SIZE = 1000;

/** A member belongs to one primary subunit plus up to three more. */
export const MAX_SUBUNITS_PER_MEMBER = 4;

/**
 * Default country calling code for phone numbers stored in local form.
 * wa.me requires a full international number, so "08031234567" has to become
 * "2348031234567" or the link silently fails (AUDIT CRS-3). Nigeria (+234).
 */
export const DEFAULT_COUNTRY_CODE = "234";

/** Welfare escalation ceiling (welfare_followups.level is checked 1..3). */
export const MAX_WELFARE_LEVEL = 3;

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
