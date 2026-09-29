"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, CheckCircle2, MessageCircleOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import { remindInstructorsToAddWhatsApp, type MissingWhatsAppRow } from "../actions";

/**
 * Instructors whose courses have no working assignment-submission route.
 *
 * A course whose instructor can't be reached on WhatsApp is quietly broken —
 * members tap "Submit" and nothing reaches anyone. This surfaces exactly who to
 * chase, and chases them.
 */
export function MissingWhatsAppPanel({ rows }: { rows: MissingWhatsAppRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (rows.length === 0) {
    return (
      <Card className="mb-6 border-[var(--success)]/40 bg-[var(--success)]/5">
        <CardContent className="flex items-center gap-2 py-3.5 text-sm">
          <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
          Every course instructor has a WhatsApp number — assignment submissions all have
          somewhere to go.
        </CardContent>
      </Card>
    );
  }

  async function remind() {
    setBusy(true);
    try {
      const { notified } = await remindInstructorsToAddWhatsApp();
      toast({
        title: `Reminded ${notified} instructor${notified === 1 ? "" : "s"}`,
        description: "They've been asked to add their number under My profile.",
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
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6 border-[var(--danger)]/40 bg-[var(--danger)]/5">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircleOff className="h-4 w-4 text-[var(--danger)]" />
            {rows.length} instructor{rows.length === 1 ? "" : "s"} can&apos;t receive assignments
          </CardTitle>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Members submit assignments by opening a WhatsApp chat with the course instructor.
            These people have no valid number on their profile, so that button goes nowhere.
          </p>
        </div>
        <Button size="sm" onClick={remind} disabled={busy}>
          <BellRing className="h-4 w-4" />
          {busy ? "Sending…" : "Remind them all"}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-[var(--border)]">
          {rows.map((r) => (
            <div
              key={r.instructorId}
              className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5"
            >
              <span className="text-sm font-medium">{r.instructorName}</span>
              <span className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                {r.courseCount} course{r.courseCount === 1 ? "" : "s"}
                {r.publishedCourseCount > 0 && (
                  <Badge variant="danger">{r.publishedCourseCount} published</Badge>
                )}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
