"use client";

import { useState, useTransition } from "react";
import { Loader2, UserPlus, Undo2, CheckCircle2 } from "lucide-react";
import { restoreEveryone, previewMissingMembers, createMissingMembers } from "./actions";
import type { MissingPerson } from "@/lib/roster-restore";
import { toast } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Undoing the removal pass, and filling in the people it left out.
 *
 * Kept visually separate from the reconcile flow above it: that one takes
 * access away, this one only ever gives it back or adds somebody, and the two
 * should not be easy to confuse.
 */
export function RestorePanel({ revokedCount }: { revokedCount: number }) {
  return (
    <div className="mt-8 space-y-4">
      <RestoreEveryoneCard revokedCount={revokedCount} />
      <MissingMembersCard />
    </div>
  );
}

function RestoreEveryoneCard({ revokedCount }: { revokedCount: number }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <Undo2 className="h-4 w-4" /> Put everyone back
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-[var(--text-muted)]">
          Clears every access removal, sets anyone marked as left back to active, and lifts
          their sign-in ban. Nothing is deleted by this and it is safe to press twice.
          {revokedCount > 0 && (
            <>
              {" "}
              <strong>{revokedCount}</strong>{" "}
              {revokedCount === 1 ? "account is" : "accounts are"} currently removed.
            </>
          )}
        </p>
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await restoreEveryone();
              if (!r.ok) {
                toast({ title: "Could not restore", description: r.error, variant: "error" });
                return;
              }
              setDone(
                `${r.reactivated} put back on the roster, ${r.unrevoked} access removals cleared, ${r.unbanned} sign-ins unblocked.`
              );
              toast({
                title: "Everyone restored",
                description: r.failures?.length
                  ? `${r.failures.length} needed attention.`
                  : undefined,
                variant: r.failures?.length ? "error" : "success",
              });
            })
          }
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
          Restore everyone
        </Button>
        {done && (
          <p className="flex items-center gap-2 text-sm text-[var(--success)]">
            <CheckCircle2 className="h-4 w-4" /> {done}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MissingMembersCard() {
  const [pending, start] = useTransition();
  const [missing, setMissing] = useState<MissingPerson[] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserPlus className="h-4 w-4" /> People with no account yet
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-[var(--text-muted)]">
          Checks the members list and all six subunit sheets against the site, and names anyone
          the department has written down who has no account. Matching is the same as the
          assignment scripts — spelling pairs, then phone number, then name — so a person who is
          already here under another spelling is not offered twice.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await previewMissingMembers();
                if (!r.ok) {
                  toast({ title: "Could not check", description: r.error, variant: "error" });
                  return;
                }
                setMissing(r.missing ?? []);
                setSummary(
                  `${r.total} people across the members list and the sheets; ${r.present} already have an account.`
                );
              })
            }
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Check who is missing
          </Button>

          {missing && missing.length > 0 && (
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await createMissingMembers(
                    missing.map((m) => ({ name: m.name, phone: m.phone }))
                  );
                  if (!r.ok) {
                    toast({ title: "Could not create", description: r.error, variant: "error" });
                    return;
                  }
                  setCreated(
                    `${r.created} created${r.skipped ? `, ${r.skipped} already existed` : ""}.`
                  );
                  setMissing([]);
                  toast({
                    title: `${r.created} added`,
                    description: r.failures?.length
                      ? `${r.failures.length} could not be created.`
                      : undefined,
                    variant: r.failures?.length ? "error" : "success",
                  });
                })
              }
            >
              <UserPlus className="h-4 w-4" /> Create all {missing.length}
            </Button>
          )}
        </div>

        {summary && <p className="text-sm text-[var(--text-muted)]">{summary}</p>}
        {created && (
          <p className="flex items-center gap-2 text-sm text-[var(--success)]">
            <CheckCircle2 className="h-4 w-4" /> {created}
          </p>
        )}

        {missing && missing.length > 0 && (
          <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {missing.map((m) => (
              <li key={`${m.name}-${m.phone ?? ""}`} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <span className="min-w-0 flex-1 text-sm font-medium">{m.name}</span>
                <span className="text-xs text-[var(--text-muted)]">
                  {m.phone ?? "no phone number"}
                </span>
                {m.sources.map((s: string) => (
                  <Badge key={s} variant="neutral">
                    {s}
                  </Badge>
                ))}
              </li>
            ))}
          </ul>
        )}

        {missing && missing.length === 0 && !created && (
          <p className="flex items-center gap-2 text-sm text-[var(--success)]">
            <CheckCircle2 className="h-4 w-4" /> Everyone on the lists has an account.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
