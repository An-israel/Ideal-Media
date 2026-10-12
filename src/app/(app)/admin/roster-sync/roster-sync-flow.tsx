"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ShieldCheck, UserMinus, UserPlus, Check, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import {
  previewRosterSync,
  applyRosterSync,
  restoreAccess,
  type PreviewResult,
} from "./actions";

type Preview = Extract<PreviewResult, { ok: true }>;

/** What the admin decided for one entry that could not be matched confidently. */
type Decision = { kind: "match"; accountId: string } | { kind: "create" } | { kind: "skip" };

export function RosterSyncFlow({
  alreadyRevoked,
}: {
  alreadyRevoked: { id: string; fullName: string; revokedAt: string; reason: string | null }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [reason, setReason] = useState("Not on the current members list");
  const [confirmText, setConfirmText] = useState("");
  /** Opt-in: role holders are never removed automatically. */
  const [alsoRemoveRoleHolders, setAlsoRemoveRoleHolders] = useState(false);

  function runPreview(skipPositions: number[] = []) {
    start(async () => {
      const res = await previewRosterSync({ text, skipPositions });
      if (!res.ok) {
        toast({ title: "Couldn't read that list", description: res.error, variant: "error" });
        return;
      }
      setPreview(res);
      setDecisions({});
      setConfirmText("");
    });
  }

  if (!preview) {
    return (
      <div className="space-y-4">
        {alreadyRevoked.length > 0 && (
          <RevokedList rows={alreadyRevoked} pending={pending} start={start} router={router} />
        )}
        <Card>
          <CardContent className="space-y-4 py-5">
            <div className="space-y-2">
              <Label htmlFor="list">The official members list</Label>
              <Textarea
                id="list"
                rows={14}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={"1. Full Name - 08012345678\n2. Another Name - 09012345678\n…"}
              />
              <p className="text-xs text-[var(--text-muted)]">
                One member per numbered line. Anyone on the site but <strong>not</strong> on
                this list will be shown for removal. Nothing is changed until you approve it on
                the next screen.
              </p>
            </div>
            <Button disabled={pending || !text.trim()} onClick={() => runPreview()}>
              {pending ? "Checking…" : "Check this list"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { plan, parsed } = preview;
  const undecided = plan.confirm.filter((c) => !decisions[c.listed.position]);

  const revokeIds = [
    ...plan.revoke.map((a) => a.id),
    ...(alsoRemoveRoleHolders ? plan.protectedFromRevoke.map((a) => a.id) : []),
  ];
  const createRows = [
    ...plan.create.map((m) => ({ name: m.name, phone: m.phone })),
    ...plan.confirm
      .filter((c) => decisions[c.listed.position]?.kind === "create")
      .map((c) => ({ name: c.listed.name, phone: c.listed.phone })),
  ];

  // What the department actually cares about: how many accounts stay active.
  const activeAfter = preview.accountsOnSite - revokeIds.length + createRows.length;

  const ready = undecided.length === 0 && confirmText.trim().toUpperCase() === "REMOVE";

  function apply() {
    start(async () => {
      const res = await applyRosterSync({
        revokeUserIds: revokeIds,
        createMembers: createRows,
        reason,
      });
      if (!res.ok) {
        toast({ title: "Nothing was changed", description: res.error, variant: "error" });
        return;
      }
      toast({
        title: "Members list updated",
        description: `${res.revoked} removed, ${res.created} created.`,
      });
      if (res.failures && res.failures.length > 0) {
        toast({
          title: `${res.failures.length} problem(s)`,
          description: res.failures.slice(0, 3).join(" · "),
          variant: "error",
        });
      }
      setPreview(null);
      setText("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">What this will do</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pb-5">
          <div className="flex flex-wrap gap-6">
            <Stat label="On your list" value={parsed.total} />
            <Stat label="Accounts on site" value={preview.accountsOnSite} />
            <Stat label="Matched, keeping access" value={plan.keep.length} tone="success" />
            <Stat label="Will lose access" value={plan.revoke.length} tone="danger" />
            <Stat label="Will be created" value={createRows.length} />
            <Stat label="Need your decision" value={undecided.length} tone="warning" />
            <Stat
              label="Active after this"
              value={activeAfter}
              tone={activeAfter > parsed.total ? "warning" : "success"}
            />
          </div>

          <Warn>
            Removing access does <strong>not</strong> delete anyone. They cannot sign in and
            drop off every roster and future report, but their attendance history is kept and
            past reports still read exactly as you sent them. You can restore any of them here.
          </Warn>

          {activeAfter > parsed.total && (
            <Warn>
              {activeAfter} accounts would stay active, but your list has {parsed.total} names.
              The difference is{" "}
              {plan.protectedFromRevoke.length > 0 && !alsoRemoveRoleHolders
                ? `the ${plan.protectedFromRevoke.length} role holder(s) below, which are not removed automatically`
                : "accounts still awaiting a decision above"}
              .
            </Warn>
          )}

          {parsed.possibleDuplicates.map(({ a, b }) => (
            <Warn key={`${a.position}-${b.position}`}>
              <strong>#{a.position} {a.name}</strong> and <strong>#{b.position} {b.name}</strong>{" "}
              look like the same person.{" "}
              <button
                className="underline"
                onClick={() => runPreview([Math.max(a.position, b.position)])}
              >
                Treat #{Math.max(a.position, b.position)} as a duplicate and re-check
              </button>
            </Warn>
          ))}

          {parsed.suspectPhones.map((m) => (
            <Warn key={m.position}>
              <strong>#{m.position} {m.name}</strong> has <strong>{m.phone}</strong>, which is
              not a Nigerian mobile number. It was ignored for matching, so this person was
              matched on their name only.
            </Warn>
          ))}

          {parsed.unreadable.map((u) => (
            <Warn key={u.line}>
              Line {u.line} could not be read and was skipped: &ldquo;{u.text}&rdquo;
            </Warn>
          ))}
        </CardContent>
      </Card>

      {plan.confirm.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {plan.confirm.length} {plan.confirm.length === 1 ? "entry needs" : "entries need"}{" "}
              your decision
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-[var(--border)] p-0">
            {plan.confirm.map((c) => {
              const d = decisions[c.listed.position];
              return (
                <div key={c.listed.position} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">
                      #{c.listed.position} {c.listed.name}
                    </p>
                    {c.listed.phone && (
                      <Badge variant="neutral">{c.listed.phone}</Badge>
                    )}
                    {d && <Badge variant="success">decided</Badge>}
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">{c.reason}</p>
                  <Select
                    aria-label={`What to do with ${c.listed.name}`}
                    value={d ? (d.kind === "match" ? d.accountId : d.kind) : ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDecisions((s) => ({
                        ...s,
                        [c.listed.position]:
                          v === ""
                            ? undefined!
                            : v === "create"
                              ? { kind: "create" }
                              : v === "skip"
                                ? { kind: "skip" }
                                : { kind: "match", accountId: v },
                      }));
                    }}
                  >
                    <option value="">Choose…</option>
                    {c.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        Keep existing account: {o.fullName}
                      </option>
                    ))}
                    <option value="create">Create a new account for them</option>
                    <option value="skip">Leave this entry alone for now</option>
                  </Select>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {plan.protectedFromRevoke.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" />
              {plan.protectedFromRevoke.length} account
              {plan.protectedFromRevoke.length === 1 ? "" : "s"} protected
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pb-5">
            <p className="text-sm text-[var(--text-muted)]">
              Not on your list, but they hold a role. They are kept by default so this cannot
              lock out your secretary, welfare team or your own second account by accident.
            </p>
            <ul className="space-y-1 text-sm">
              {plan.protectedFromRevoke.map((a) => (
                <li key={a.id}>
                  {a.fullName} — <span className="text-[var(--text-muted)]">{a.roles.join(", ")}</span>
                </li>
              ))}
            </ul>
            <label className="flex items-start gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={alsoRemoveRoleHolders}
                onChange={(e) => setAlsoRemoveRoleHolders(e.target.checked)}
              />
              <span>
                Remove {plan.protectedFromRevoke.length === 1 ? "this account" : "these accounts"}{" "}
                too &mdash; the list is the list. Read the names above first; your own account is
                never removed.
              </span>
            </label>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-[var(--danger)]">
            <UserMinus className="h-4 w-4" /> {plan.revoke.length} will lose access
          </CardTitle>
        </CardHeader>
        <CardContent className="max-h-80 divide-y divide-[var(--border)] overflow-y-auto p-0">
          {plan.revoke.length === 0 && (
            <p className="px-4 py-6 text-sm text-[var(--text-muted)]">
              Nobody on the site is missing from your list.
            </p>
          )}
          {plan.revoke.map((a) => (
            <p key={a.id} className="px-4 py-2 text-sm">
              {a.fullName}
            </p>
          ))}
        </CardContent>
      </Card>

      {createRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4" /> {createRows.length} will be created
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-64 divide-y divide-[var(--border)] overflow-y-auto p-0">
            {createRows.map((m) => (
              <p key={m.name} className="px-4 py-2 text-sm">
                {m.name}{" "}
                <span className="text-[var(--text-muted)]">{m.phone ?? "no phone"}</span>
              </p>
            ))}
            <p className="px-4 py-3 text-xs text-[var(--text-muted)]">
              Created without a subunit. They appear in the report&apos;s &ldquo;nobody reports
              on them&rdquo; list until you assign primary subunits.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3 py-5">
          <div className="space-y-2">
            <Label htmlFor="reason">Reason (recorded against each person)</Label>
            <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {undecided.length > 0 ? (
            <Warn>
              Decide the {undecided.length} outstanding{" "}
              {undecided.length === 1 ? "entry" : "entries"} above before applying.
            </Warn>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="confirm">
                Type <strong>REMOVE</strong> to confirm {plan.revoke.length} removal
                {plan.revoke.length === 1 ? "" : "s"}
              </Label>
              <Input
                id="confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="REMOVE"
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending || !ready} onClick={apply}>
              <Check className="h-4 w-4" />
              {pending ? "Applying…" : "Apply changes"}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setPreview(null)}>
              Back to the list
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RevokedList({
  rows,
  pending,
  start,
  router,
}: {
  rows: { id: string; fullName: string; revokedAt: string; reason: string | null }[];
  pending: boolean;
  start: (fn: () => void) => void;
  router: { refresh: () => void };
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {rows.length} member{rows.length === 1 ? "" : "s"} currently without access
        </CardTitle>
      </CardHeader>
      <CardContent className="max-h-72 divide-y divide-[var(--border)] overflow-y-auto p-0">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.fullName}</p>
              <p className="truncate text-xs text-[var(--text-muted)]">
                {r.reason ?? "No reason recorded"} · {r.revokedAt.slice(0, 10)}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await restoreAccess(r.id);
                  if (!res.ok) {
                    toast({ title: "Not restored", description: res.error, variant: "error" });
                    return;
                  }
                  toast({ title: `${r.fullName} can sign in again` });
                  router.refresh();
                })
              }
            >
              <Undo2 className="h-4 w-4" /> Restore
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "danger" | "warning";
}) {
  const color =
    tone === "success"
      ? "text-[var(--success)]"
      : tone === "danger"
        ? "text-[var(--danger)]"
        : tone === "warning"
          ? "text-[var(--warning)]"
          : "";
  return (
    <div>
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className={`text-2xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-3 py-2 text-sm text-[var(--warning)]">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
