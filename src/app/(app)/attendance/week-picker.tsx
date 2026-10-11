"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { shiftWeeks, sundayOfWeek } from "@/lib/attendance-window";

/**
 * Moves between reporting weeks.
 *
 * Reporting is a standing weekly job, not a one-off, so every week has to stay
 * reachable: a leader who missed last Wednesday steps back and files it, and a
 * correction to a month-old service is three clicks away.
 *
 * The date box accepts any day and snaps to that week's Sunday, so picking the
 * Wednesday — or any day in the week — lands on the right week rather than
 * producing a service date that never existed.
 */
export function WeekPicker({
  basePath,
  weekSunday,
  currentWeek,
  label,
}: {
  basePath: string;
  weekSunday: string;
  /** This week's Sunday, so "This week" can be hidden when already there. */
  currentWeek: string;
  label: string;
}) {
  const router = useRouter();
  const go = (sunday: string) => router.push(`${basePath}?week=${sunday}`);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <Button
        size="sm"
        variant="ghost"
        aria-label="Previous week"
        onClick={() => go(shiftWeeks(weekSunday, -1))}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <CalendarDays className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
        <span className="truncate text-sm font-medium">{label}</span>
      </div>

      <Input
        type="date"
        aria-label="Jump to a week"
        className="w-auto"
        value={weekSunday}
        onChange={(e) => {
          const v = e.target.value;
          if (v) go(sundayOfWeek(v));
        }}
      />

      {weekSunday !== currentWeek && (
        <Button size="sm" variant="outline" onClick={() => go(currentWeek)}>
          This week
        </Button>
      )}

      <Button
        size="sm"
        variant="ghost"
        aria-label="Next week"
        onClick={() => go(shiftWeeks(weekSunday, 1))}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
