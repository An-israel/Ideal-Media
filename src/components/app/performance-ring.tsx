import { pct } from "@/lib/performance";

/** A percentage ring with the three-part breakdown beneath (Section 14). */
export function PerformanceRing({
  value,
  parts,
  size = 132,
}: {
  value: number; // 0..1 composite
  parts: { progress: number; assignments: number; attendance: number };
  size?: number;
}) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = c * Math.max(0, Math.min(1, value));

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--border)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${c}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold">{pct(value)}%</span>
          <span className="text-xs text-[var(--text-muted)]">Performance</span>
        </div>
      </div>
      <div className="w-full max-w-[260px] space-y-1.5 text-sm">
        <Part label="Course progress" value={parts.progress} />
        <Part label="Assignment approval" value={parts.assignments} />
        <Part label="Attendance" value={parts.attendance} />
      </div>
    </div>
  );
}

function Part({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="truncate text-[var(--text-muted)]">{label}</span>
      <span className="shrink-0 font-medium">{pct(value)}%</span>
    </div>
  );
}
