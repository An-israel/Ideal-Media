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
    <div className="flex items-center gap-5">
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
      <div className="space-y-2 text-sm">
        <Part label="Course progress" value={parts.progress} />
        <Part label="Assignment approval" value={parts.assignments} />
        <Part label="Attendance" value={parts.attendance} />
      </div>
    </div>
  );
}

function Part({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-36 text-[var(--text-muted)]">{label}</span>
      <span className="font-medium">{pct(value)}%</span>
    </div>
  );
}
