"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import {
  previewSubunitAssignment,
  applySubunitAssignment,
  type AssignPreview,
} from "./actions";

export function AssignFlow({
  subunits,
}: {
  subunits: { id: string; name: string; category: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [subunitId, setSubunitId] = useState(subunits[0]?.id ?? "");
  const [membershipType, setMembershipType] = useState<"primary" | "secondary">("primary");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<AssignPreview | null>(null);
  /** Per list position: the account id chosen, or "" to leave them out. */
  const [picks, setPicks] = useState<Record<number, string>>({});

  const subunitName = subunits.find((s) => s.id === subunitId)?.name ?? "";

  function runPreview() {
    start(async () => {
      const res = await previewSubunitAssignment({ text, subunitId });
      if (!res.ok) {
        toast({ title: "Couldn't read that", description: res.error, variant: "error" });
        return;
      }
      setPreview(res.preview);
      setPicks({});
    });
  }

  const chosen = preview
    ? preview.rows
        .map((r) => r.accountId ?? picks[r.listed.position] ?? "")
        .filter(Boolean)
    : [];
  const undecided = preview
    ? preview.rows.filter((r) => !r.accountId && picks[r.listed.position] === undefined)
    : [];
  const moves = preview
    ? preview.rows.filter(
        (r) =>
          membershipType === "primary" &&
          (r.accountId ?? picks[r.listed.position]) &&
          r.currentPrimary &&
          r.currentPrimary !== subunitName
      )
    : [];

  function apply() {
    start(async () => {
      const res = await applySubunitAssignment({
        subunitId,
        membershipType,
        userIds: [...new Set(chosen)],
      });
      if (!res.ok) {
        toast({ title: "Nothing was changed", description: res.error, variant: "error" });
        return;
      }
      toast({
        title: `${subunitName} updated`,
        description: `${res.assigned} assigned, ${res.moved} moved.`,
      });
      if (res.skipped?.length) {
        toast({
          title: `${res.skipped.length} skipped`,
          description: res.skipped.slice(0, 3).join(" · "),
          variant: "error",
        });
      }
      setPreview(null);
      setText("");
      router.refresh();
    });
  }

  if (!preview) {
    return (
      <Card>
        <CardContent className="space-y-4 py-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="su">Subunit</Label>
              <Select id="su" value={subunitId} onChange={(e) => setSubunitId(e.target.value)}>
                {subunits.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.category})
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mt">Membership</Label>
              <Select
                id="mt"
                value={membershipType}
                onChange={(e) => setMembershipType(e.target.value as "primary" | "secondary")}
              >
                <option value="primary">Primary — this is their main unit</option>
                <option value="secondary">Secondary — they also serve here</option>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sheet">The unit&apos;s member sheet</Label>
            <Textarea
              id="sheet"
              rows={14}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"1. Full Name\t09012345678\n2. Another Name\n…"}
            />
            <p className="text-xs text-[var(--text-muted)]">
              Numbers are optional, and a tab, spaces or a dash all work. Nobody is ever removed
              from a subunit by this — a sheet says who belongs, not who does not.
            </p>
          </div>
          <Button disabled={pending || !text.trim() || !subunitId} onClick={runPreview}>
            {pending ? "Checking…" : "Check this sheet"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {subunitName} · {membershipType === "primary" ? "primary" : "secondary"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pb-5">
          <div className="flex flex-wrap gap-6">
            <Stat label="On the sheet" value={preview.rows.length + preview.notFound.length} />
            <Stat label="Will be assigned" value={new Set(chosen).size} tone="success" />
            <Stat label="Need a decision" value={undecided.length} tone="warning" />
            <Stat label="Not on the site" value={preview.notFound.length} tone="danger" />
          </div>

          {moves.length > 0 && (
            <Warn>
              <ArrowRightLeft className="mr-1 inline h-3 w-3" />
              {moves.length} {moves.length === 1 ? "person is" : "people are"} currently primary
              in another subunit and will be <strong>moved</strong> to {subunitName}:{" "}
              {moves.slice(0, 5).map((m) => `${m.accountName ?? m.listed.name} (${m.currentPrimary})`).join(", ")}
              {moves.length > 5 && ` and ${moves.length - 5} more`}.
            </Warn>
          )}

          {preview.notFound.length > 0 && (
            <Warn>
              {preview.notFound.length} on this sheet{" "}
              {preview.notFound.length === 1 ? "has" : "have"} no account on the site and{" "}
              {preview.notFound.length === 1 ? "is" : "are"} skipped:{" "}
              {preview.notFound.slice(0, 6).map((m) => m.name).join(", ")}
              {preview.notFound.length > 6 && ` and ${preview.notFound.length - 6} more`}. Add
              them under Secretary → Roster first if they really are members.
            </Warn>
          )}

          {preview.unreadable.length > 0 && (
            <Warn>
              {preview.unreadable.length} line
              {preview.unreadable.length === 1 ? "" : "s"} could not be read and{" "}
              {preview.unreadable.length === 1 ? "was" : "were"} skipped — e.g. &ldquo;
              {preview.unreadable[0].text}&rdquo;.
            </Warn>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="divide-y divide-[var(--border)] p-0">
          {preview.rows.map((r) => {
            const picked = r.accountId ?? picks[r.listed.position];
            return (
              <div key={r.listed.position} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">
                    #{r.listed.position} {r.accountName ?? r.listed.name}
                    {r.accountName && r.accountName !== r.listed.name && (
                      <span className="text-[var(--text-muted)]">
                        {" "}
                        (sheet says &ldquo;{r.listed.name}&rdquo;)
                      </span>
                    )}
                  </p>
                  {r.currentPrimary && (
                    <Badge variant="neutral">now: {r.currentPrimary}</Badge>
                  )}
                  {r.accountId ? (
                    <Badge variant={r.confidence === "phone" ? "success" : "warning"}>
                      {r.confidence === "phone" ? "matched by phone" : r.confidence}
                    </Badge>
                  ) : picked ? (
                    <Badge variant="success">you chose</Badge>
                  ) : (
                    <Badge variant="danger">needs a decision</Badge>
                  )}
                </div>
                {!r.accountId && (
                  <>
                    {r.note && <p className="text-xs text-[var(--text-muted)]">{r.note}</p>}
                    <Select
                      aria-label={`Who is ${r.listed.name}?`}
                      value={picks[r.listed.position] ?? ""}
                      onChange={(e) =>
                        setPicks((s) => ({ ...s, [r.listed.position]: e.target.value }))
                      }
                    >
                      <option value="">Leave them out</option>
                      {r.options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.fullName}
                        </option>
                      ))}
                    </Select>
                  </>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button disabled={pending || chosen.length === 0} onClick={apply}>
          <Check className="h-4 w-4" />
          {pending ? "Assigning…" : `Assign ${new Set(chosen).size} to ${subunitName}`}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={() => setPreview(null)}>
          Back to the sheet
        </Button>
      </div>
    </div>
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
