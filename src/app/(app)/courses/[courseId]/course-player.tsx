"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Lock,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  Download,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { submitModule } from "../actions";
import type { ContentType, ModuleProgressStatus } from "@/lib/database.types";

export type PlayerModule = {
  id: string;
  position: number;
  title: string;
  contentType: ContentType;
  contentUrls: string[];
  contentBody: string | null;
  instructions: string | null;
  status: ModuleProgressStatus;
  rejectionNote: string | null;
  locked: boolean;
};

const STATUS_META: Record<ModuleProgressStatus, { label: string; variant: "neutral" | "default" | "success" | "warning" }> = {
  not_started: { label: "Not started", variant: "neutral" },
  in_progress: { label: "Needs redo", variant: "warning" },
  submitted: { label: "Submitted", variant: "default" },
  approved: { label: "Approved", variant: "success" },
};

function youtubeEmbed(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

export function CoursePlayer({ modules }: { modules: PlayerModule[] }) {
  const router = useRouter();
  const firstUnlocked = modules.find((m) => !m.locked)?.id ?? modules[0]?.id;
  const [activeId, setActiveId] = useState(firstUnlocked);
  const [submitting, setSubmitting] = useState(false);

  const active = useMemo(() => modules.find((m) => m.id === activeId), [modules, activeId]);

  if (modules.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-[var(--text-muted)]">
          This course has no modules yet.
        </CardContent>
      </Card>
    );
  }

  async function onSubmit() {
    if (!active) return;
    setSubmitting(true);
    try {
      const { waLink } = await submitModule(active.id);
      if (waLink) {
        window.open(waLink, "_blank", "noopener");
      } else {
        toast({
          title: "Submitted",
          description: "Your leader has no WhatsApp number on file — they've been notified in-app.",
          variant: "success",
        });
      }
      router.refresh();
    } catch (e) {
      toast({ title: "Could not submit", description: String(e), variant: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      {/* Module rail */}
      <aside className="space-y-1">
        {modules.map((m) => {
          const isActive = m.id === activeId;
          return (
            <button
              key={m.id}
              disabled={m.locked}
              onClick={() => setActiveId(m.id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                m.locked && "cursor-not-allowed opacity-50",
                isActive ? "bg-[var(--accent)]/10 text-[var(--accent)]" : "hover:bg-[var(--border)]/40"
              )}
            >
              {m.locked ? (
                <Lock className="h-4 w-4 shrink-0" />
              ) : m.status === "approved" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--success)]" />
              ) : m.status === "submitted" ? (
                <Clock className="h-4 w-4 shrink-0 text-[var(--accent)]" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
              )}
              <span className="truncate">
                {m.position}. {m.title}
              </span>
            </button>
          );
        })}
      </aside>

      {/* Active module */}
      {active && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{active.title}</h2>
            <Badge variant={STATUS_META[active.status].variant}>
              {STATUS_META[active.status].label}
            </Badge>
          </div>

          <ContentBlock module={active} />

          {active.instructions && (
            <Card>
              <CardContent className="space-y-3 pt-6">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  Assignment
                </h3>
                <p className="whitespace-pre-wrap text-sm">{active.instructions}</p>

                {active.status === "in_progress" && active.rejectionNote && (
                  <div className="rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-3 text-sm text-[var(--warning)]">
                    Needs redo: {active.rejectionNote}
                  </div>
                )}

                {active.status === "approved" ? (
                  <p className="text-sm text-[var(--success)]">
                    Approved — the next module is unlocked.
                  </p>
                ) : active.status === "submitted" ? (
                  <p className="text-sm text-[var(--text-muted)]">
                    Submitted — waiting for your leader to review on WhatsApp.
                  </p>
                ) : (
                  <Button onClick={onSubmit} disabled={submitting}>
                    <Send className="h-4 w-4" />
                    {submitting ? "Submitting…" : "Submit to leader on WhatsApp"}
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function ContentBlock({ module: m }: { module: PlayerModule }) {
  const urls = m.contentUrls.filter(Boolean);

  // YouTube: embed every link that resolves to a video; fall back to a link.
  if (m.contentType === "youtube" && urls.length > 0) {
    const embeds = urls.map((u) => ({ url: u, embed: youtubeEmbed(u) }));
    if (embeds.some((e) => e.embed)) {
      return (
        <div className="space-y-4">
          {embeds.map((e, i) =>
            e.embed ? (
              <div
                key={i}
                className="aspect-video overflow-hidden rounded-2xl border border-[var(--border)]"
              >
                <iframe
                  src={e.embed}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <a key={i} href={e.url} target="_blank" rel="noopener noreferrer">
                <Button variant="outline">
                  <ExternalLink className="h-4 w-4" /> Open video {i + 1}
                </Button>
              </a>
            )
          )}
        </div>
      );
    }
  }

  if (m.contentType === "video" && urls.length > 0) {
    return (
      <div className="space-y-4">
        {urls.map((u, i) => (
          <video key={i} controls className="w-full rounded-2xl border border-[var(--border)]">
            <source src={u} />
          </video>
        ))}
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        {urls.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {urls.map((u, i) => (
              <a key={i} href={u} target="_blank" rel="noopener noreferrer">
                <Button variant="outline">
                  {m.contentType === "file" ? (
                    <>
                      <Download className="h-4 w-4" />{" "}
                      {urls.length > 1 ? `Download ${i + 1}` : "Download / open"}
                    </>
                  ) : (
                    <>
                      <ExternalLink className="h-4 w-4" />{" "}
                      {urls.length > 1 ? `Open ${i + 1}` : "Open content"}
                    </>
                  )}
                </Button>
              </a>
            ))}
          </div>
        )}
        {m.contentBody && <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.contentBody}</p>}
        {urls.length === 0 && !m.contentBody && (
          <p className="text-sm text-[var(--text-muted)]">No content provided for this module.</p>
        )}
      </CardContent>
    </Card>
  );
}
