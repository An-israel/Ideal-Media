"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, LogOut, ArrowRightLeft, Users, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { MAX_SUBUNITS_PER_MEMBER } from "@/lib/constants";
import { ApplyCourseButton } from "@/app/(app)/courses/apply-course-button";
import {
  joinSubunit,
  leaveSubunit,
  requestPrimaryChange,
  cancelPrimaryChangeRequest,
  type SubunitActionResult,
} from "./actions";

export interface BrowserSubunit {
  id: string;
  name: string;
  category: string;
  description: string | null;
  memberCount: number;
  membership: "primary" | "secondary" | null;
  courses: {
    id: string;
    title: string;
    instructorName: string | null;
    enrollmentStatus: string | null;
  }[];
}

export interface PendingRequest {
  id: string;
  subunitId: string;
  subunitName: string;
  reason: string | null;
}

export function SubunitsBrowser({
  subunits,
  atSubunitLimit,
  pendingRequest,
}: {
  subunits: BrowserSubunit[];
  /** How many subunits the member is currently in. */
  atSubunitLimit: number;
  pendingRequest: PendingRequest | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [changingFor, setChangingFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const full = atSubunitLimit >= MAX_SUBUNITS_PER_MEMBER;

  async function run(fn: () => Promise<SubunitActionResult>) {
    setBusy(true);
    try {
      const result = await fn();
      if (!result.ok) {
        toast({ title: "Couldn't do that", description: result.error, variant: "error" });
        return false;
      }
      toast({ title: result.message ?? "Done", variant: "success" });
      router.refresh();
      return true;
    } catch (e) {
      toast({
        title: "Something went wrong",
        description: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {pendingRequest && (
        <Card className="border-[var(--warning)]/40 bg-[var(--warning)]/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 h-4 w-4 text-[var(--warning)]" />
              <div>
                <p className="text-sm font-medium">
                  Your move to {pendingRequest.subunitName} is waiting for review
                </p>
                {pendingRequest.reason && (
                  <p className="text-sm text-[var(--text-muted)]">
                    Your reason: {pendingRequest.reason}
                  </p>
                )}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => run(() => cancelPrimaryChangeRequest(pendingRequest.id))}
            >
              Cancel request
            </Button>
          </CardContent>
        </Card>
      )}

      {full && (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 text-sm text-[var(--text-muted)]">
          You&apos;re in {atSubunitLimit} subunits, which is the maximum. Leave one before
          joining another.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {subunits.map((s) => {
          const isPrimary = s.membership === "primary";
          const isSecondary = s.membership === "secondary";
          const isMember = isPrimary || isSecondary;
          const changing = changingFor === s.id;

          return (
            <Card key={s.id} className="flex flex-col">
              <CardHeader className="flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {isPrimary && <Badge>Your primary</Badge>}
                  {isSecondary && <Badge variant="neutral">You&apos;re a member</Badge>}
                  <Badge variant="neutral">{s.category}</Badge>
                  <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                    <Users className="h-3 w-3" />
                    {s.memberCount}
                  </span>
                </div>
                <CardTitle className="text-base">{s.name}</CardTitle>
                {s.description && <CardDescription>{s.description}</CardDescription>}
              </CardHeader>

              <CardContent className="space-y-3">
                {/* Courses in this subunit — the reason to join in the first place. */}
                {s.courses.length > 0 && (
                  <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
                    <p className="text-xs font-medium text-[var(--text-muted)]">
                      Courses in this subunit
                    </p>
                    {s.courses.map((c) => (
                      <div key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm">
                          {c.title}
                          {c.instructorName && (
                            <span className="block text-xs text-[var(--text-muted)]">
                              Taught by {c.instructorName}
                            </span>
                          )}
                        </span>
                        {c.enrollmentStatus === "enrolled" ? (
                          <Badge variant="success">Enrolled</Badge>
                        ) : c.enrollmentStatus === "pending_application" ? (
                          <Badge variant="warning">Requested</Badge>
                        ) : c.enrollmentStatus === "rejected" ? (
                          <Badge variant="danger">Declined</Badge>
                        ) : isMember ? (
                          <ApplyCourseButton courseId={c.id} courseTitle={c.title} />
                        ) : (
                          <span className="text-xs text-[var(--text-muted)]">
                            Join to request
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Membership controls */}
                {!isMember && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busy || full}
                      onClick={() => run(() => joinSubunit(s.id))}
                    >
                      <LogIn className="h-4 w-4" /> Join
                    </Button>
                    {!pendingRequest && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setChangingFor(changing ? null : s.id);
                          setReason("");
                        }}
                      >
                        <ArrowRightLeft className="h-4 w-4" /> Make this my primary
                      </Button>
                    )}
                  </div>
                )}

                {isSecondary && (
                  <div className="flex flex-wrap gap-2">
                    {!pendingRequest && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setChangingFor(changing ? null : s.id);
                          setReason("");
                        }}
                      >
                        <ArrowRightLeft className="h-4 w-4" /> Make this my primary
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Leave ${s.name}?`)) return;
                        void run(() => leaveSubunit(s.id));
                      }}
                    >
                      <LogOut className="h-4 w-4" /> Leave
                    </Button>
                  </div>
                )}

                {isPrimary && (
                  <p className="text-xs text-[var(--text-muted)]">
                    This is your primary subunit — it decides which attendance register
                    you&apos;re on. To move, pick another subunit and choose &ldquo;Make this my
                    primary&rdquo;.
                  </p>
                )}

                {changing && (
                  <div className="space-y-2 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-3">
                    <Label htmlFor={`reason-${s.id}`}>
                      Why do you want {s.name} as your primary subunit?
                    </Label>
                    <Textarea
                      id={`reason-${s.id}`}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. I joined the wrong unit by mistake — I actually serve in this one."
                      className="min-h-16"
                    />
                    <p className="text-xs text-[var(--text-muted)]">
                      A leader or secretary reviews this, because your primary subunit decides
                      your attendance register and auto-enrolled courses.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={async () => {
                          const ok = await run(() => requestPrimaryChange(s.id, reason));
                          if (ok) {
                            setChangingFor(null);
                            setReason("");
                          }
                        }}
                      >
                        Send request
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setChangingFor(null)}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
