import { PERFORMANCE_WEIGHTS } from "@/lib/constants";

export interface PerformanceParts {
  /** approved modules / total enrolled modules */
  progress: number;
  /** approved / (submitted + rejected) */
  assignments: number;
  /** present / expected over the trailing window */
  attendance: number;
}

/** Composite = 40% progress + 30% assignments + 30% attendance (Section 14). */
export function compositeScore(parts: PerformanceParts): number {
  const { progress, assignments, attendance } = PERFORMANCE_WEIGHTS;
  return (
    parts.progress * progress +
    parts.assignments * assignments +
    parts.attendance * attendance
  );
}

export function pct(n: number): number {
  return Math.round(Math.max(0, Math.min(1, n)) * 100);
}
