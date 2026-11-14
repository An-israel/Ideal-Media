"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play } from "lucide-react";
import { setLearnerSuspended } from "./actions";
import { toast } from "@/components/ui/toaster";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

export type LearnerRow = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  joined: string;
  suspended: boolean;
  suspendedReason: string | null;
  coursesStarted: number;
  lessonsDone: number;
  certificates: number;
  lastActive: string | null;
};

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function LearnersTable({ rows }: { rows: LearnerRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? rows.filter((r) => r.fullName.toLowerCase().includes(q) || r.email.toLowerCase().includes(q))
      : rows;
  }, [rows, query]);

  const toggle = (r: LearnerRow) =>
    start(async () => {
      let reason: string | undefined;
      if (!r.suspended) {
        const typed = window.prompt(
          `Pause ${r.fullName}? They will not be able to use the courses and their certificates will stop verifying. Nothing is deleted.\n\nReason (shown to them):`,
          "Paused by an administrator."
        );
        if (typed === null) return;
        reason = typed;
      }
      const res = await setLearnerSuspended(r.id, !r.suspended, reason);
      if (!res.ok) {
        toast({ title: "Not changed", description: res.error, variant: "error" });
        return;
      }
      toast({ title: r.suspended ? `${r.fullName} restored` : `${r.fullName} paused`, variant: "success" });
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search by name or email…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-xs"
      />
      <Card>
        <CardContent className="divide-y divide-[var(--border)] p-0">
          {shown.length === 0 && (
            <p className="px-5 py-10 text-center text-sm text-[var(--text-muted)]">
              {rows.length === 0
                ? "Nobody has joined for the courses yet. The sign-up page is /learn/signup."
                : "No learners match."}
            </p>
          )}
          {shown.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {r.fullName}{" "}
                  {r.suspended && <Badge variant="danger">Paused</Badge>}
                </p>
                <p className="truncate text-xs text-[var(--text-muted)]">
                  {r.email}
                  {r.phone ? ` · ${r.phone}` : ""} · joined {day(r.joined)}
                  {r.lastActive ? ` · last active ${day(r.lastActive)}` : ""}
                </p>
                {r.suspended && r.suspendedReason && (
                  <p className="truncate text-xs text-[var(--danger)]">{r.suspendedReason}</p>
                )}
              </div>
              <span className="text-xs text-[var(--text-muted)]">
                {r.coursesStarted} course{r.coursesStarted === 1 ? "" : "s"} · {r.lessonsDone} lesson
                {r.lessonsDone === 1 ? "" : "s"} · {r.certificates} cert{r.certificates === 1 ? "" : "s"}
              </span>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => toggle(r)}>
                {r.suspended ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                {r.suspended ? "Restore" : "Pause"}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
