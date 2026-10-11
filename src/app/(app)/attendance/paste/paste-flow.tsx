"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { reasonLabel } from "@/lib/absence-reasons";
import { previewAbsenteePaste, commitAbsenteePaste, type PastePreview } from "../actions";

export function PasteFlow({
  services,
}: {
  services: { id: string; name: string; date: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [serviceKey, setServiceKey] = useState(services[0] ? `${services[0].id}|${services[0].date}` : "");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PastePreview | null>(null);
  /** Choices for names the matcher could not resolve on its own. */
  const [resolved, setResolved] = useState<Record<string, string>>({});

  const [activityId, serviceDate] = serviceKey.split("|");

  function runPreview() {
    start(async () => {
      const res = await previewAbsenteePaste({ activityId, serviceDate, text });
      if (!res.ok) {
        toast({ title: "Couldn't read that", description: res.error, variant: "error" });
        return;
      }
      setPreview(res.preview);
      setResolved({});
    });
  }

  function commit() {
    if (!preview) return;
    const absentees = preview.rows
      .map((r) => {
        const userId = r.matchedUserId ?? resolved[r.written] ?? null;
        return userId ? { userId, reason: r.reason, note: r.note } : null;
      })
      .filter(Boolean) as { userId: string; reason: PastePreview["rows"][number]["reason"]; note: string | null }[];

    start(async () => {
      const res = await commitAbsenteePaste({ activityId, serviceDate, absentees });
      if (!res.ok) {
        toast({ title: "Not saved", description: res.error, variant: "error" });
        return;
      }
      toast({
        title: "Attendance recorded",
        description: `${res.present} present, ${res.absent} absent.`,
      });
      router.push("/attendance");
      router.refresh();
    });
  }

  const stillUnmatched = preview
    ? preview.rows.filter((r) => !r.matchedUserId && !resolved[r.written])
    : [];

  if (!preview) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-4 py-5">
            <div className="space-y-2">
              <Label htmlFor="service">Which service is this for?</Label>
              <Select
                id="service"
                value={serviceKey}
                onChange={(e) => setServiceKey(e.target.value)}
              >
                {services.map((s) => (
                  <option key={s.id} value={`${s.id}|${s.date}`}>
                    {s.name} — {s.date}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="report">The absentee report</Label>
              <Textarea
                id="report"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={14}
                placeholder={
                  "Paste the whole message, headings and all:\n\n*Absentee Categorization (43 Total):*\n\n* *Absent Due to Illness: 7*\n- Opara Chidumebi Elisheva: sick and woke up late\n…"
                }
              />
              <p className="text-xs text-[var(--text-muted)]">
                Paste it exactly as you send it — the bold markers, bullets and notes after each
                name are all understood. Nothing is saved until you have seen what it will change.
              </p>
            </div>

            <Button disabled={pending || !text.trim() || !serviceKey} onClick={runPreview}>
              <ClipboardPaste className="h-4 w-4" />
              {pending ? "Reading…" : "Read the report"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">What this will do</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 py-0 pb-5">
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-xs text-[var(--text-muted)]">Marked present</p>
              <p className="text-2xl font-semibold text-[var(--success)]">
                {preview.willMarkPresent}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)]">Marked absent</p>
              <p className="text-2xl font-semibold text-[var(--danger)]">
                {preview.willMarkAbsent}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)]">On the roll</p>
              <p className="text-2xl font-semibold">{preview.rollTotal}</p>
            </div>
          </div>

          {preview.declaredTotalMembers !== null &&
            preview.declaredTotalMembers !== preview.rollTotal && (
              <Warning>
                The report says {preview.declaredTotalMembers} members but the roster here has{" "}
                {preview.rollTotal}. Somebody may be missing from the system, or marked
                graduated/left.
              </Warning>
            )}

          {preview.changingFromPresent > 0 && (
            <Warning>
              {preview.changingFromPresent}{" "}
              {preview.changingFromPresent === 1 ? "person was" : "people were"} already recorded
              present for this service and will be changed to absent.
            </Warning>
          )}

          {preview.countWarnings.map((w) => (
            <Warning key={w.heading}>
              &ldquo;{w.heading}&rdquo; says {w.declared} but {w.found}{" "}
              {w.found === 1 ? "name was" : "names were"} listed under it.
            </Warning>
          ))}

          {preview.unknownHeadings.map((h) => (
            <Warning key={h.line}>
              Line {h.line} looks like a heading but isn&apos;t a category I know:{" "}
              &ldquo;{h.text}&rdquo;. Names under it were skipped.
            </Warning>
          ))}

          {preview.orphanLines.length > 0 && (
            <Warning>
              {preview.orphanLines.length}{" "}
              {preview.orphanLines.length === 1 ? "line was" : "lines were"} not under any
              heading and {preview.orphanLines.length === 1 ? "was" : "were"} skipped — e.g. line{" "}
              {preview.orphanLines[0].line}: &ldquo;{preview.orphanLines[0].text}&rdquo;.
            </Warning>
          )}
        </CardContent>
      </Card>

      {stillUnmatched.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {stillUnmatched.length}{" "}
              {stillUnmatched.length === 1 ? "name needs" : "names need"} your help
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-[var(--border)] p-0">
            {stillUnmatched.map((r) => (
              <div key={r.written} className="space-y-2 px-4 py-3">
                <p className="text-sm font-medium">{r.written}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {r.options.length > 0
                    ? "More than one person could be meant."
                    : "Nobody on the roster matches this name."}
                </p>
                {r.options.length > 0 && (
                  <Select
                    aria-label={`Who is ${r.written}?`}
                    value={resolved[r.written] ?? ""}
                    onChange={(e) =>
                      setResolved((s) => ({ ...s, [r.written]: e.target.value }))
                    }
                  >
                    <option value="">Leave them out</option>
                    {r.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.fullName}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            ))}
            <p className="px-4 py-3 text-xs text-[var(--text-muted)]">
              Anyone left out here is counted <strong>present</strong>, because they are on the
              roll and not named as absent. Fix their name on the roster if that is wrong.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {preview.rows.length} absentees read from the report
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-[var(--border)] p-0">
          {preview.rows.map((r) => {
            const chosen = r.matchedUserId ?? resolved[r.written];
            return (
              <div key={`${r.written}-${r.reason}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {r.matchedName ?? r.written}
                    {r.matchedName && r.matchedName !== r.written && (
                      <span className="text-[var(--text-muted)]"> (written &ldquo;{r.written}&rdquo;)</span>
                    )}
                  </p>
                  {r.note && <p className="truncate text-xs text-[var(--text-muted)]">{r.note}</p>}
                </div>
                <Badge variant="neutral">{reasonLabel(r.reason)}</Badge>
                {chosen ? (
                  r.confidence === "exact" || r.confidence === "same-tokens" ? (
                    <Badge variant="success">matched</Badge>
                  ) : (
                    <Badge variant="warning">
                      {r.confidence === "subset" ? "close match" : "you chose"}
                    </Badge>
                  )
                ) : (
                  <Badge variant="danger">no match</Badge>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={commit}>
          <Check className="h-4 w-4" />
          {pending
            ? "Saving…"
            : `Record ${preview.willMarkPresent} present and ${
                preview.rows.filter((r) => r.matchedUserId || resolved[r.written]).length
              } absent`}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={() => setPreview(null)}>
          <ArrowRight className="h-4 w-4 rotate-180" /> Back to the text
        </Button>
      </div>
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-3 py-2 text-sm text-[var(--warning)]">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
