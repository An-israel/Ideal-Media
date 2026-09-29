"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { decideSubunitRequest } from "../actions";

export interface QueueRequest {
  id: string;
  memberName: string;
  fromSubunit: string | null;
  toSubunit: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reason: string | null;
  decisionNote: string | null;
  createdAt: string;
}

const STATUS_VARIANT: Record<
  QueueRequest["status"],
  "neutral" | "warning" | "success" | "danger"
> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
};

export function RequestQueue({
  pending,
  decided,
}: {
  pending: QueueRequest[];
  decided: QueueRequest[];
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Waiting for review ({pending.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {pending.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-[var(--text-muted)]">
              Nothing waiting. 🎉
            </p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {pending.map((r) => (
                <PendingRow key={r.id} request={r} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {decided.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recently decided</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-[var(--border)]">
              {decided.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.memberName}</p>
                    <p className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                      {r.fromSubunit ?? "No subunit"}
                      <ArrowRight className="h-3 w-3" />
                      {r.toSubunit}
                    </p>
                    {r.decisionNote && (
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        Note: {r.decisionNote}
                      </p>
                    )}
                  </div>
                  <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PendingRow({ request }: { request: QueueRequest }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function decide(approve: boolean) {
    if (
      !approve &&
      !window.confirm(`Decline ${request.memberName}'s move to ${request.toSubunit}?`)
    ) {
      return;
    }
    setBusy(true);
    try {
      const result = await decideSubunitRequest(request.id, approve, note);
      if (!result.ok) {
        toast({ title: "Couldn't decide", description: result.error, variant: "error" });
        return;
      }
      toast({ title: result.message ?? "Done", variant: "success" });
      router.refresh();
    } catch (e) {
      toast({
        title: "Something went wrong",
        description: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 px-5 py-4">
      <div>
        <p className="text-sm font-medium">{request.memberName}</p>
        <p className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          {request.fromSubunit ?? "No subunit"}
          <ArrowRight className="h-3 w-3" />
          {request.toSubunit}
        </p>
        {request.reason && (
          <p className="mt-1.5 rounded-lg bg-[var(--bg)] px-3 py-2 text-sm">
            &ldquo;{request.reason}&rdquo;
          </p>
        )}
      </div>

      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note for the member…"
      />

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => decide(true)}>
          <Check className="h-4 w-4" /> Approve the move
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => decide(false)}>
          <X className="h-4 w-4" /> Decline
        </Button>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        Approving makes {request.toSubunit} their primary subunit and enrolls them in its
        published courses. Their old subunit becomes an additional one, so their history there
        is kept.
      </p>
    </div>
  );
}
