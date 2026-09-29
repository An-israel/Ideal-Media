import { TEACHING_COMPLETE_FRACTION } from "@/lib/constants";

/**
 * Listen-tracking maths. Kept free of `server-only` so it can be unit tested —
 * this is the logic that decides whether "has listened" is true, so it is worth
 * having tests around.
 */

/**
 * Percentage listened, from real playback time rather than position reached.
 *
 * Seeking to the end moves the playhead but not `listenedSeconds`, so this
 * can't be gamed by dragging the slider. Returns 100 for a completed teaching
 * even when the duration is unknown.
 */
export function listenPercent(
  listenedSeconds: number,
  durationSeconds: number | null | undefined,
  completed = false
): number {
  if (completed) return 100;
  if (!durationSeconds || durationSeconds <= 0) return 0;
  if (!Number.isFinite(listenedSeconds) || listenedSeconds <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((listenedSeconds / durationSeconds) * 100)));
}

/** True once enough of the teaching has actually been played. */
export function qualifiesAsListened(
  listenedSeconds: number,
  durationSeconds: number | null | undefined
): boolean {
  if (!durationSeconds || durationSeconds <= 0) return false;
  if (!Number.isFinite(listenedSeconds)) return false;
  return listenedSeconds >= durationSeconds * TEACHING_COMPLETE_FRACTION;
}

/**
 * Clamps a client-reported increment of play time.
 *
 * The player posts how much it played since the last report. A client could
 * claim anything, so only a plausible tick is accepted — this is what stops
 * someone marking an hour of listening in a single request.
 */
export function clampPlayedIncrement(playedSeconds: number, maxIncrement = 60): number {
  if (!Number.isFinite(playedSeconds) || playedSeconds <= 0) return 0;
  return Math.min(maxIncrement, Math.round(playedSeconds));
}
