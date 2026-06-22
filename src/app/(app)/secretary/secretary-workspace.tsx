"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Upload, UploadCloud, CalendarClock, Users } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type GridMember = {
  id: string;
  name: string;
  subunit: string;
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

export function SecretaryWorkspace({
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
  const router = useRouter();
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase())),
    [members, query]
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Secretary</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Your attendance sheet. Upload or import and it updates here, and welfare is
          notified automatically about who missed service.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2">
        <Link href="/secretary/attendance" className={buttonVariants()}>
          <Upload className="h-4 w-4" />
          Upload attendance
        </Link>
        <Link href="/secretary/import-members" className={buttonVariants({ variant: "secondary" })}>
          <UploadCloud className="h-4 w-4" />
          Import members
        </Link>
        <Link href="/secretary/import-attendance" className={buttonVariants({ variant: "secondary" })}>
          <CalendarClock className="h-4 w-4" />
          Import past attendance
        </Link>
        <Link href="/secretary/roster" className={buttonVariants({ variant: "secondary" })}>
          <Users className="h-4 w-4" />
          Roster
        </Link>
      </div>

      {/* Sheet controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--text-muted)]">Register:</span>
          <Select
            value={activeActivityId}
            onChange={(e) => router.push(`/secretary?activity=${e.target.value}`)}
            className="h-9 w-44"
          >
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        <Input
          placeholder="Search members…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 max-w-xs"
        />
      </div>

      {dates.length === 0 && members.length > 0 && (
        <p className="text-sm text-[var(--text-muted)]">
          Showing your <b>{members.length}</b> members. No attendance recorded for this
          register yet — use <b>Upload attendance</b> or <b>Import past attendance</b> and
          date columns will fill in here.
        </p>
      )}

      {/* Spreadsheet */}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {members.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-[var(--text-muted)]">
              No members yet. Use <b>Import members</b> above to add your team.
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-[var(--bg)] text-xs text-[var(--text-muted)]">
                  <th className="sticky left-0 z-10 border border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 text-left font-medium">
                    Member
                  </th>
                  <th className="border border-[var(--border)] px-3 py-2.5 text-center font-medium">Rate</th>
                  {dates.map((d) => (
                    <th
                      key={d}
                      className="border border-[var(--border)] px-3 py-2.5 text-center font-medium whitespace-nowrap"
                    >
                      {shortDate(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id}>
                    <td className="sticky left-0 z-10 border border-[var(--border)] bg-[var(--surface)] px-4 py-2">
                      <span className="font-medium">{m.name}</span>
                      {m.subunit && (
                        <span className="block text-xs text-[var(--text-muted)]">{m.subunit}</span>
                      )}
                    </td>
                    <td className="border border-[var(--border)] px-3 py-2 text-center text-[var(--text-muted)]">
                      {m.rate == null ? "—" : `${m.rate}%`}
                    </td>
                    {dates.map((d) => {
                      const st = m.statuses[d];
                      const mark = st ? MARK[st] : null;
                      return (
                        <td key={d} className="border border-[var(--border)] px-3 py-2 text-center">
                          {mark ? (
                            <span
                              className={cn(
                                "inline-flex h-6 w-6 items-center justify-center rounded text-xs font-semibold",
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
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={dates.length + 2} className="px-5 py-10 text-center text-sm text-[var(--text-muted)]">
                      No members match.
                    </td>
                  </tr>
                )}
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
