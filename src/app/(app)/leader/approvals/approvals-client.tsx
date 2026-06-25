"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toaster";
import { approveModule, rejectModule, decideApplication } from "../actions";

export type SubmissionItem = {
  id: string;
  memberName: string;
  moduleTitle: string;
  modulePosition: number;
  courseTitle: string;
  submittedAt: string | null;
};

export type ApplicationItem = {
  id: string;
  memberName: string;
  courseTitle: string;
  reason: string;
};

export function ApprovalsClient({
  submissions,
  applications,
}: {
  submissions: SubmissionItem[];
  applications: ApplicationItem[];
}) {
  const router = useRouter();
  // Open on whichever queue actually has items so a non-empty tab isn't hidden.
  const [tab, setTab] = useState(
    submissions.length === 0 && applications.length > 0 ? "applications" : "submissions"
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<SubmissionItem | null>(null);
  const [note, setNote] = useState("");

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      toast({ title: "Action failed", description: String(e), variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "submissions", label: "Submissions", count: submissions.length },
          { value: "applications", label: "Applications", count: applications.length },
        ]}
      />

      {tab === "submissions" && (
        <div className="space-y-2">
          {submissions.length === 0 && <Empty label="No assignment submissions awaiting review." />}
          {submissions.map((s) => (
            <Card key={s.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p className="text-sm font-medium">{s.memberName}</p>
                  <p className="text-sm text-[var(--text-muted)]">
                    {s.courseTitle} · Module {s.modulePosition}: {s.moduleTitle}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === s.id}
                    onClick={() => { setRejecting(s); setNote(""); }}
                  >
                    <X className="h-4 w-4" /> Reject
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy === s.id}
                    onClick={() => run(s.id, () => approveModule(s.id))}
                  >
                    <Check className="h-4 w-4" /> Approve
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === "applications" && (
        <div className="space-y-2">
          {applications.length === 0 && <Empty label="No course applications awaiting review." />}
          {applications.map((a) => (
            <Card key={a.id}>
              <CardContent className="space-y-3 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{a.memberName}</p>
                    <p className="text-sm text-[var(--text-muted)]">{a.courseTitle}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy === a.id}
                      onClick={() => run(a.id, () => decideApplication(a.id, false))}
                    >
                      <X className="h-4 w-4" /> Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy === a.id}
                      onClick={() => run(a.id, () => decideApplication(a.id, true))}
                    >
                      <Check className="h-4 w-4" /> Approve
                    </Button>
                  </div>
                </div>
                {a.reason && (
                  <p className="rounded-xl bg-[var(--bg)] px-3.5 py-2.5 text-sm text-[var(--text-muted)]">
                    “{a.reason}”
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Reject submission"
        description="The member will be asked to redo and resubmit."
      >
        <div className="space-y-4">
          <Textarea
            placeholder="What needs to change? (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            className="w-full"
            disabled={!!busy}
            onClick={() => {
              if (!rejecting) return;
              const id = rejecting.id;
              setRejecting(null);
              run(id, () => rejectModule(id, note));
            }}
          >
            Send back for redo
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center text-sm text-[var(--text-muted)]">{label}</CardContent>
    </Card>
  );
}
