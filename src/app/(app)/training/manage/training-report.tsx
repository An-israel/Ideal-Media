"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { formatDuration } from "@/lib/format";
import { remindNotListened } from "./actions";
import type { TrainingReport } from "@/lib/training";

/**
 * The listen report: per teaching, how many have and haven't been through it;
 * per member, how far through the library they are.
 */
export function TrainingReportView({
  report,
  canManage,
}: {
  report: TrainingReport;
  canManage: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [remindingId, setRemindingId] = useState<string | null>(null);

  const members = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return report.perMember;
    return report.perMember.filter(
      (m) =>
        m.fullName.toLowerCase().includes(q) ||
        (m.primarySubunit ?? "").toLowerCase().includes(q)
    );
  }, [query, report.perMember]);

  async function remind(teachingId: string, title: string) {
    setRemindingId(teachingId);
    try {
      const { notified } = await remindNotListened(teachingId);
      toast({
        title: notified > 0 ? `Reminded ${notified} member(s)` : "Everyone is up to date",
        description:
          notified > 0 ? `About "${title}".` : "Nobody is outstanding on this teaching.",
        variant: "success",
      });
      router.refresh();
    } catch (e) {
      toast({
        title: "Could not send reminders",
        description: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    } finally {
      setRemindingId(null);
    }
  }

  if (report.totalTeachings === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-[var(--text-muted)]">
          No published teachings yet. Once you add and publish one, this is where you&apos;ll
          see who has listened.
        </CardContent>
      </Card>
    );
  }

  const cards = [
    { label: "Published teachings", value: report.totalTeachings },
    { label: "Members expected", value: report.eligibleMembers },
    { label: "Fully caught up", value: report.fullyCaughtUp },
    { label: "Haven't started", value: report.noneStarted },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="pt-6">
              <p className="text-sm text-[var(--text-muted)]">{c.label}</p>
              <p className="mt-1 text-2xl font-semibold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        &ldquo;Members expected&rdquo; counts active members who have claimed their account —
        imported records that have never logged in are excluded, so the percentages mean
        something.
      </p>

      {/* Per teaching */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Who has listened, per teaching</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-[var(--border)]">
            {report.perTeaching.map((t) => {
              const pct = t.eligible ? Math.round((t.listened / t.eligible) * 100) : 0;
              return (
                <div key={t.teachingId} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {t.position}. {t.title}
                        {!t.isPublished && (
                          <Badge variant="neutral" className="ml-2">
                            draft
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {t.seriesTitle} · {formatDuration(t.durationSeconds)}
                      </p>
                    </div>
                    {canManage && t.isPublished && t.notStarted + t.started > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={remindingId === t.teachingId}
                        onClick={() => remind(t.teachingId, t.title)}
                      >
                        <BellRing className="h-4 w-4" />
                        {remindingId === t.teachingId ? "Sending…" : "Remind outstanding"}
                      </Button>
                    )}
                  </div>

                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--border)]">
                    <div
                      className="h-full rounded-full bg-[var(--success)] transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                    <span className="text-[var(--success)]">
                      <b>{t.listened}</b> listened ({pct}%)
                    </span>
                    <span className="text-[var(--warning)]">
                      <b>{t.started}</b> part-way
                    </span>
                    <span className="text-[var(--text-muted)]">
                      <b>{t.notStarted}</b> not started
                    </span>
                    {t.manualCompletions > 0 && (
                      <span className="text-[var(--text-muted)]">
                        {t.manualCompletions} self-marked
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Per member */}
      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="text-base">Every member&apos;s progress</CardTitle>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or subunit…"
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {members.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-[var(--text-muted)]">No members match.</p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {members.map((m) => (
                <div key={m.userId} className="flex items-center gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.fullName}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {m.primarySubunit ?? "No primary subunit"}
                    </p>
                  </div>
                  <div className="hidden w-32 sm:block">
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--border)]">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${m.percent}%` }}
                      />
                    </div>
                  </div>
                  <p className="w-28 text-right text-xs text-[var(--text-muted)]">
                    {m.completed}/{report.totalTeachings} · {m.percent}%
                  </p>
                  {m.completed === report.totalTeachings ? (
                    <Badge variant="success">Done</Badge>
                  ) : m.completed === 0 && m.started === 0 ? (
                    <Badge variant="danger">Not started</Badge>
                  ) : (
                    <Badge variant="warning">In progress</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
