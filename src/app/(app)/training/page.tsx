import Link from "next/link";
import {
  BarChart3,
  CheckCircle2,
  Headphones,
  PlayCircle,
  Video,
  ExternalLink,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSessionRoles } from "@/lib/auth";
import { getTrainingForMember } from "@/lib/training";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDuration } from "@/lib/format";

export default async function TrainingPage() {
  const session = await getSessionRoles();
  if (!session) return null;
  const supabase = await createClient();

  const series = await getTrainingForMember(supabase, session.userId);
  const allTeachings = series.flatMap((s) => s.teachings);
  const completed = allTeachings.filter((t) => t.completed).length;

  // Managers add teachings and see the whole department; leaders see the report
  // for their own subunits.
  const canManage =
    session.roles.includes("super_admin") || session.roles.includes("secretary");
  const canSeeReport = canManage || session.ledSubunitIds.length > 0;

  return (
    <div>
      <PageHeader
        title="General Training"
        description="Teaching for the whole media department. Available to every member."
      />

      {canSeeReport && (
        <div className="mb-4">
          <Link href="/training/manage">
            <Button variant="outline" size="sm">
              <BarChart3 className="h-4 w-4" />
              {canManage ? "Manage & see who's listened" : "See who's listened"}
            </Button>
          </Link>
        </div>
      )}

      {allTeachings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Headphones className="h-8 w-8 text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">
              No training has been published yet. It will appear here when it does.
            </p>
            {canManage && (
              // A manager landing here has almost always added a teaching and
              // is wondering where it went. Name the two switches instead of
              // repeating the member-facing message at them.
              <p className="max-w-md text-sm text-[var(--text-muted)]">
                Added one already? A teaching shows here only when both its{" "}
                <strong>series</strong> and the teaching itself are published —
                open{" "}
                <Link href="/training/manage" className="underline">
                  Manage
                </Link>{" "}
                and look for anything still marked <strong>Draft</strong>.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 py-4">
              <div>
                <p className="text-xs text-[var(--text-muted)]">Your progress</p>
                <p className="text-2xl font-semibold">
                  {completed}
                  <span className="text-base font-normal text-[var(--text-muted)]">
                    {" "}
                    / {allTeachings.length} listened
                  </span>
                </p>
              </div>
              <div className="h-2 min-w-[8rem] flex-1 overflow-hidden rounded-full bg-[var(--border)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all"
                  style={{
                    width: `${allTeachings.length ? (completed / allTeachings.length) * 100 : 0}%`,
                  }}
                />
              </div>
              {completed === allTeachings.length && (
                <Badge variant="success">All caught up</Badge>
              )}
            </CardContent>
          </Card>

          <div className="space-y-8">
            {series.map((s) => (
              <section key={s.id}>
                <div className="mb-3">
                  <h2 className="text-lg font-semibold">{s.title}</h2>
                  {s.description && (
                    <p className="text-sm text-[var(--text-muted)]">{s.description}</p>
                  )}
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {s.completedCount} of {s.teachings.length} listened
                  </p>
                </div>

                {s.teachings.length === 0 ? (
                  <Card>
                    <CardContent className="py-8 text-center text-sm text-[var(--text-muted)]">
                      Nothing in this series yet.
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="divide-y divide-[var(--border)] p-0">
                      {s.teachings.map((t) => {
                        const Icon =
                          t.mediaType === "video"
                            ? Video
                            : t.mediaType === "link"
                            ? ExternalLink
                            : Headphones;
                        return (
                          <Link
                            key={t.id}
                            href={`/training/${t.id}`}
                            className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[var(--bg)]"
                          >
                            <div className="shrink-0">
                              {t.completed ? (
                                <CheckCircle2 className="h-5 w-5 text-[var(--success)]" />
                              ) : (
                                <PlayCircle className="h-5 w-5 text-[var(--text-muted)]" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {t.position}. {t.title}
                              </p>
                              <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                                <Icon className="h-3 w-3" />
                                {formatDuration(t.durationSeconds)}
                                {!t.completed && t.percent > 0 && (
                                  <span>· {t.percent}% listened</span>
                                )}
                              </p>
                            </div>
                            {t.completed ? (
                              <Badge variant="success">
                                {t.completedManually ? "Marked done" : "Listened"}
                              </Badge>
                            ) : t.percent > 0 ? (
                              <Badge variant="warning">In progress</Badge>
                            ) : (
                              <Badge variant="neutral">Not started</Badge>
                            )}
                          </Link>
                        );
                      })}
                    </CardContent>
                  </Card>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
