"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type GridMember = {
  id: string;
  name: string;
  statuses: Record<string, string>;
  rate: number | null;
};

type Activity = { id: string; name: string };

const MARK: Record<string, { label: string; className: string }> = {
  present: { label: "P", className: "bg-[var(--success)]/15 text-[var(--success)]" },
  absent: { label: "A", className: "bg-[var(--danger)]/12 text-[var(--danger)]" },
  traveled: { label: "T", className: "bg-[var(--warning)]/15 text-[var(--warning)]" },
  excused: { label: "E", className: "bg-[var(--accent)]/12 text-[var(--accent)]" },
};

function shortDate(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AttendanceGrid({
  activities,
  activeActivityId,
  dates,
  members,
}: {
  activities: Activity[];
  activeActivityId: string;
  dates: string[];
  members: GridMember[];
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase())),
    [members, query]
  );

  return (
    <div className="space-y-4">
      {/* Activity tabs */}
      <div className="flex flex-wrap gap-2">
        {activities.map((a) => (
          <Link
            key={a.id}
            href={`/secretary/attendance-records?activity=${a.id}`}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              a.id === activeActivityId
                ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg)]"
            )}
          >
            {a.name}
          </Link>
        ))}
      </div>

      <Input
        placeholder="Search members…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-xs"
      />

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {dates.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-[var(--text-muted)]">
              No attendance recorded for this activity yet. Upload or import some on the
              Attendance pages.
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                  <th className="sticky left-0 bg-[var(--surface)] px-4 py-3 text-left font-medium">Member</th>
                  <th className="px-3 py-3 text-center font-medium">Rate</th>
                  {dates.map((d) => (
                    <th key={d} className="px-3 py-3 text-center font-medium whitespace-nowrap">
                      {shortDate(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="sticky left-0 bg-[var(--surface)] px-4 py-2.5 font-medium">{m.name}</td>
                    <td className="px-3 py-2.5 text-center text-[var(--text-muted)]">
                      {m.rate == null ? "—" : `${m.rate}%`}
                    </td>
                    {dates.map((d) => {
                      const st = m.statuses[d];
                      const mark = st ? MARK[st] : null;
                      return (
                        <td key={d} className="px-3 py-2.5 text-center">
                          {mark ? (
                            <span
                              className={cn(
                                "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                                mark.className
                              )}
                            >
                              {mark.label}
                            </span>
                          ) : (
                            <span className="text-[var(--border)]">·</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-[var(--text-muted)]">
        P = present · A = absent · T = traveled · E = excused · · = no record
      </p>
    </div>
  );
}
