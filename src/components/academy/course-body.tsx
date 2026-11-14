"use client";

import { useState, useTransition } from "react";
import {
  Check,
  Circle,
  CheckCircle2,
  ChevronDown,
  Smartphone,
  Laptop,
  Award,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { videosFor, isDualLesson, type ModuleWithContent } from "@/lib/academy-content";
import { setLessonDone, submitAssignment, claimCertificate } from "@/app/(app)/academy/actions";
import { toast } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Device = "phone" | "laptop";

export function CourseBody({
  basePath = "/academy",
  courseId,
  courseSlug,
  courseTitle,
  hasDeviceSplit,
  modules,
  steps,
  doneSteps,
  complete,
  certificate,
}: {
  /** "/academy" inside the department's app, "/learn" for course-only learners. */
  basePath?: string;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  /** Whether any lesson here really has a phone and a laptop version. */
  hasDeviceSplit: boolean;
  modules: ModuleWithContent[];
  steps: number;
  doneSteps: number;
  complete: boolean;
  certificate: { code: string; issued_at: string } | null;
}) {
  // One choice for the whole course: somebody learning on a phone is on a
  // phone for all of it, and re-picking per lesson would be twelve taps.
  const [device, setDevice] = useState<Device>(hasDeviceSplit ? "phone" : "laptop");
  const [open, setOpen] = useState<string | null>(
    modules.find((m) => !m.complete)?.id ?? modules[0]?.id ?? null
  );

  const pct = steps > 0 ? Math.round((doneSteps / steps) * 100) : 0;

  return (
    <div className="mt-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">Your progress</span>
            <span className="text-[var(--text-muted)]">
              {doneSteps} of {steps}
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {hasDeviceSplit && (
          <div className="flex rounded-lg border border-[var(--border)] p-0.5">
            {(["phone", "laptop"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDevice(d)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                  device === d
                    ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]"
                )}
              >
                {d === "phone" ? (
                  <Smartphone className="h-3.5 w-3.5" />
                ) : (
                  <Laptop className="h-3.5 w-3.5" />
                )}
                {d === "phone" ? "Phone" : "Laptop"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {modules.map((m) => (
          <ModuleCard
            key={m.id}
            module={m}
            device={device}
            open={open === m.id}
            onToggle={() => setOpen(open === m.id ? null : m.id)}
          />
        ))}
      </div>

      <CertificateCard
        basePath={basePath}
        courseId={courseId}
        courseSlug={courseSlug}
        courseTitle={courseTitle}
        complete={complete}
        certificate={certificate}
      />
    </div>
  );
}

function ModuleCard({
  module: m,
  device,
  open,
  onToggle,
}: {
  module: ModuleWithContent;
  device: Device;
  open: boolean;
  onToggle: () => void;
}) {
  const doneCount = m.lessons.filter((l) => l.done).length;

  return (
    <Card className="overflow-hidden p-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-[var(--bg)]"
      >
        <span className="shrink-0">
          {m.complete ? (
            <CheckCircle2 className="h-5 w-5 text-[var(--success)]" />
          ) : (
            <Circle className="h-5 w-5 text-[var(--text-muted)]" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            Module {m.position}: {m.title}
          </span>
          {m.goal && (
            <span className="mt-0.5 block text-xs text-[var(--text-muted)]">{m.goal}</span>
          )}
        </span>
        <Badge variant={m.complete ? "success" : "neutral"}>
          {doneCount}/{m.lessons.length} lessons
        </Badge>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="border-t border-[var(--border)]">
          {m.lessons.map((l) => (
            <LessonRow key={l.id} lesson={l} modulePosition={m.position} device={device} />
          ))}
          {m.assignment && (
            <AssignmentRow assignment={m.assignment} submission={m.submission} />
          )}
        </div>
      )}
    </Card>
  );
}

function LessonRow({
  lesson,
  modulePosition,
  device,
}: {
  lesson: ModuleWithContent["lessons"][number];
  modulePosition: number;
  device: Device;
}) {
  const [watching, setWatching] = useState(false);
  const [pending, start] = useTransition();
  const videos = videosFor(lesson.videos, device);
  const main = videos[0];
  const backups = videos.slice(1);

  return (
    <div className="border-b border-[var(--border)] px-5 py-4 last:border-b-0">
      <div className="flex flex-wrap items-start gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              try {
                await setLessonDone(lesson.id, !lesson.done);
              } catch (e) {
                toast({
                  title: "Couldn't save that",
                  description: e instanceof Error ? e.message : "Please try again.",
                  variant: "error",
                });
              }
            })
          }
          aria-label={lesson.done ? "Mark as not done" : "Mark as done"}
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
            lesson.done
              ? "border-[var(--success)] bg-[var(--success)] text-white"
              : "border-[var(--border)] hover:border-[var(--accent)]"
          )}
        >
          {pending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : lesson.done ? (
            <Check className="h-3 w-3" />
          ) : null}
        </button>

        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-medium", lesson.done && "text-[var(--text-muted)]")}>
            {modulePosition}.{lesson.position} {lesson.title}
          </p>
          {lesson.summary && (
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">{lesson.summary}</p>
          )}
          {isDualLesson(lesson.videos) && (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Showing the {device} version.
            </p>
          )}
        </div>

        {main && (
          <Button size="sm" variant="outline" onClick={() => setWatching((w) => !w)}>
            {watching ? "Hide video" : "Watch"}
          </Button>
        )}
      </div>

      {watching && main && (
        <div className="mt-3">
          <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
            <iframe
              className="h-full w-full"
              src={`https://www.youtube-nocookie.com/embed/${main.youtube_id}`}
              title={main.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">{main.title}</p>
          {backups.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-[var(--text-muted)]">
                Video not working? {backups.length}{" "}
                {backups.length === 1 ? "alternative" : "alternatives"}
              </summary>
              <ul className="mt-2 space-y-1">
                {backups.map((b) => (
                  <li key={b.youtube_id}>
                    <a
                      href={b.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                    >
                      {b.title} <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function AssignmentRow({
  assignment,
  submission,
}: {
  assignment: NonNullable<ModuleWithContent["assignment"]>;
  submission: ModuleWithContent["submission"];
}) {
  const [link, setLink] = useState(submission?.link ?? "");
  const [checked, setChecked] = useState<number[]>(submission?.checked ?? []);
  const [pending, start] = useTransition();
  const done = !!submission;

  const toggle = (i: number) =>
    setChecked((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]));

  const submit = () =>
    start(async () => {
      try {
        await submitAssignment(assignment.id, { link, checked });
        toast({ title: done ? "Updated" : "Submitted", variant: "success" });
      } catch (e) {
        toast({
          title: "Not submitted",
          description: e instanceof Error ? e.message : "Please try again.",
          variant: "error",
        });
      }
    });

  return (
    <div className="border-t border-[var(--border)] bg-[var(--bg)] px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm font-medium">{assignment.title}</p>
        <Badge variant={done ? "success" : "neutral"}>
          {done ? "Submitted" : assignment.kind === "link" ? "Link required" : "Self-check"}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-[var(--text-muted)]">{assignment.instructions}</p>

      {assignment.checklist.length > 0 && (
        <ul className="mt-3 space-y-2">
          {assignment.checklist.map((item, i) => (
            <li key={item}>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                  checked={checked.includes(i)}
                  onChange={() => toggle(i)}
                />
                <span>{item}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {assignment.kind === "link" && (
        <div className="mt-3">
          <Input
            type="url"
            inputMode="url"
            placeholder="https://… link to your work"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" onClick={submit} disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {done ? "Update" : "Submit"}
        </Button>
        {done && submission?.link && (
          <a
            href={submission.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
          >
            Your submission <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

function CertificateCard({
  basePath,
  courseId,
  courseSlug,
  courseTitle,
  complete,
  certificate,
}: {
  basePath: string;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  complete: boolean;
  certificate: { code: string; issued_at: string } | null;
}) {
  const [pending, start] = useTransition();
  const [code, setCode] = useState(certificate?.code ?? null);

  if (!complete && !code) {
    return (
      <Card className="mt-6">
        <CardContent className="flex items-start gap-3 py-4">
          <Award className="mt-0.5 h-5 w-5 shrink-0 text-[var(--text-muted)]" />
          <p className="text-sm text-[var(--text-muted)]">
            Finish every lesson and submit every assignment to earn your certificate for{" "}
            {courseTitle}.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-6 border-[var(--success)]/40">
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <Award className="h-4 w-4 text-[var(--success)]" /> Course complete
        </CardTitle>
      </CardHeader>
      <CardContent>
        {code ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">
              Certificate <span className="font-mono font-medium">{code}</span>
            </p>
            <a href={`${basePath}/${courseSlug}/certificate`}>
              <Button size="sm" variant="outline">
                View certificate
              </Button>
            </a>
          </div>
        ) : (
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                try {
                  const r = await claimCertificate(courseId);
                  setCode(r.code);
                  toast({ title: "Certificate issued", variant: "success" });
                } catch (e) {
                  toast({
                    title: "Couldn't issue it",
                    description: e instanceof Error ? e.message : "Please try again.",
                    variant: "error",
                  });
                }
              })
            }
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Get my certificate
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
