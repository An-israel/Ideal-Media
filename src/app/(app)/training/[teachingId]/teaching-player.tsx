"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import { formatClock } from "@/lib/format";
import { TEACHING_PROGRESS_INTERVAL_SECONDS } from "@/lib/constants";
import { reportProgress, markTeachingListened } from "../actions";
import type { TeachingMediaType } from "@/lib/database.types";

export interface TeachingPlayerProps {
  teachingId: string;
  mediaType: TeachingMediaType;
  /** Signed URL for an uploaded teaching, or the external link. */
  mediaUrl: string | null;
  durationSeconds: number | null;
  /** Where to resume from. */
  furthestSeconds: number;
  listenedSeconds: number;
  completed: boolean;
  completedManually: boolean;
}

/**
 * Plays a teaching and reports REAL listening time back to the server.
 *
 * The honest-measurement trick: we accumulate elapsed `timeupdate` deltas and
 * ignore any jump bigger than a couple of seconds, because such a jump is a
 * seek, not listening. So dragging the slider to the end leaves the counted
 * total at almost nothing, and "has listened" in the admin report means the
 * person actually played it through.
 */
export function TeachingPlayer({
  teachingId,
  mediaType,
  mediaUrl,
  durationSeconds,
  furthestSeconds,
  listenedSeconds,
  completed,
  completedManually,
}: TeachingPlayerProps) {
  const router = useRouter();
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  // Play time not yet sent to the server.
  const unreportedRef = useRef(0);
  // Last position we saw, to measure the delta between ticks.
  const lastPositionRef = useRef(0);
  const flushingRef = useRef(false);
  const resumedRef = useRef(false);

  const [isComplete, setIsComplete] = useState(completed);
  const [totalListened, setTotalListened] = useState(listenedSeconds);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const [position, setPosition] = useState(furthestSeconds);
  const [marking, setMarking] = useState(false);

  /** Sends accumulated play time. Safe to call often; no-ops when there's none. */
  const flush = useCallback(
    async (opts?: { force?: boolean }) => {
      const played = unreportedRef.current;
      if (played <= 0 && !opts?.force) return;
      if (flushingRef.current) return;
      flushingRef.current = true;
      unreportedRef.current = 0;

      try {
        const result = await reportProgress({
          teachingId,
          playedSeconds: played,
          positionSeconds: lastPositionRef.current,
          durationSeconds: duration || undefined,
        });
        setTotalListened(result.listenedSeconds);
        if (result.completed && !isComplete) {
          setIsComplete(true);
          toast({
            title: "Marked as listened",
            description: "Thanks — this teaching is now recorded as complete.",
            variant: "success",
          });
          router.refresh();
        }
      } catch (e) {
        // Put the time back so it isn't lost, and stay quiet — a failed
        // progress ping must never interrupt listening.
        unreportedRef.current += played;
        console.error("[training] progress report failed:", e);
      } finally {
        flushingRef.current = false;
      }
    },
    [teachingId, duration, isComplete, router]
  );

  // Periodic flush while playing.
  useEffect(() => {
    const id = setInterval(() => {
      void flush();
    }, TEACHING_PROGRESS_INTERVAL_SECONDS * 1000);
    return () => clearInterval(id);
  }, [flush]);

  // Flush on leaving the page so the last few seconds aren't lost.
  useEffect(() => {
    const onHide = () => {
      if (unreportedRef.current > 0) void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      onHide();
    };
  }, [flush]);

  function onLoadedMetadata() {
    const el = mediaRef.current;
    if (!el) return;
    if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration);

    // Resume where they left off, but not if they'd essentially finished.
    if (!resumedRef.current && furthestSeconds > 5) {
      resumedRef.current = true;
      const target = Math.min(furthestSeconds, (el.duration || furthestSeconds) - 5);
      if (target > 0) {
        el.currentTime = target;
        lastPositionRef.current = target;
      }
    }
  }

  function onTimeUpdate() {
    const el = mediaRef.current;
    if (!el) return;
    const now = el.currentTime;
    const delta = now - lastPositionRef.current;
    lastPositionRef.current = now;
    setPosition(now);

    // Only forward, and only a plausible tick. A larger jump is a seek (or a
    // tab that was throttled), so it is not counted as listening.
    if (delta > 0 && delta < 2) {
      unreportedRef.current += delta;
    }
  }

  function onSeeked() {
    const el = mediaRef.current;
    if (el) lastPositionRef.current = el.currentTime;
  }

  async function toggleManual() {
    setMarking(true);
    try {
      await markTeachingListened(teachingId, !isComplete);
      setIsComplete(!isComplete);
      toast({
        title: isComplete ? "Unmarked" : "Marked as listened",
        variant: "success",
      });
      router.refresh();
    } catch (e) {
      toast({
        title: "Could not update",
        description: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    } finally {
      setMarking(false);
    }
  }

  const percent = duration > 0 ? Math.min(100, Math.round((totalListened / duration) * 100)) : 0;

  // A link-type teaching lives on someone else's site, so playback can't be
  // measured — it can only be self-declared.
  if (mediaType === "link") {
    return (
      <Card>
        <CardContent className="space-y-4 py-6">
          {mediaUrl ? (
            <a href={mediaUrl} target="_blank" rel="noopener noreferrer">
              <Button>
                <ExternalLink className="h-4 w-4" /> Open the teaching
              </Button>
            </a>
          ) : (
            <p className="text-sm text-[var(--danger)]">This teaching has no link on file.</p>
          )}
          <p className="text-sm text-[var(--text-muted)]">
            This teaching is hosted elsewhere, so we can&apos;t track playback. Tick below once
            you&apos;ve listened to it.
          </p>
          <ManualTick
            isComplete={isComplete}
            marking={marking}
            onToggle={toggleManual}
            canUntick
          />
        </CardContent>
      </Card>
    );
  }

  if (!mediaUrl) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-[var(--danger)]">
            The media for this teaching couldn&apos;t be loaded. Please tell an admin.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-6">
        {mediaType === "video" ? (
          <video
            ref={mediaRef as React.RefObject<HTMLVideoElement>}
            src={mediaUrl}
            controls
            preload="metadata"
            className="w-full rounded-xl bg-black"
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
            onSeeked={onSeeked}
            onPause={() => void flush()}
            onEnded={() => void flush({ force: true })}
          />
        ) : (
          <audio
            ref={mediaRef as React.RefObject<HTMLAudioElement>}
            src={mediaUrl}
            controls
            preload="metadata"
            className="w-full"
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
            onSeeked={onSeeked}
            onPause={() => void flush()}
            onEnded={() => void flush({ force: true })}
          />
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>
              {formatClock(position)}
              {duration > 0 && ` / ${formatClock(duration)}`}
            </span>
            <span>
              {isComplete ? (
                <Badge variant="success">
                  {completedManually && percent < 90 ? "Marked done" : "Listened"}
                </Badge>
              ) : (
                <>{percent}% listened</>
              )}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all"
              style={{ width: `${isComplete ? 100 : percent}%` }}
            />
          </div>
          {!isComplete && (
            <p className="text-xs text-[var(--text-muted)]">
              This bar tracks how much you&apos;ve actually played — skipping ahead
              doesn&apos;t count. It completes on its own near the end.
            </p>
          )}
        </div>

        <ManualTick
          isComplete={isComplete}
          marking={marking}
          onToggle={toggleManual}
          canUntick={completedManually || percent < 90}
        />
      </CardContent>
    </Card>
  );
}

function ManualTick({
  isComplete,
  marking,
  onToggle,
  canUntick,
}: {
  isComplete: boolean;
  marking: boolean;
  onToggle: () => void;
  canUntick: boolean;
}) {
  if (isComplete) {
    return (
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4">
        <span className="flex items-center gap-2 text-sm text-[var(--success)]">
          <CheckCircle2 className="h-4 w-4" /> Recorded as listened.
        </span>
        {canUntick && (
          <Button size="sm" variant="ghost" onClick={onToggle} disabled={marking}>
            Undo
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--border)] pt-4">
      <Button size="sm" variant="outline" onClick={onToggle} disabled={marking}>
        <CheckCircle2 className="h-4 w-4" />
        {marking ? "Saving…" : "I've already listened to this"}
      </Button>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        Use this only if you listened somewhere else — it&apos;s recorded separately from a
        tracked playthrough.
      </p>
    </div>
  );
}
