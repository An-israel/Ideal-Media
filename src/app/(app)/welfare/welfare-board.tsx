"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toaster";
import { buildWhatsAppLink, cn } from "@/lib/utils";
import { updateFollowup } from "./actions";
import type { WelfareReason, WelfareStatus } from "@/lib/database.types";

export type FollowupItem = {
  id: string;
  memberName: string;
  whatsapp: string | null;
  reason: WelfareReason;
  level: number;
  status: WelfareStatus;
  notes: string;
  assignedTo: string | null;
  lastContactAt: string | null;
  createdAt: string;
  missedCount: number | null;
};

const REASON_LABEL: Record<WelfareReason, string> = {
  new_member: "New member",
  missed_service: "Missed service",
  traveled: "Traveled",
};
const STATUSES: WelfareStatus[] = ["pending", "in_progress", "contacted", "resolved"];

function relative(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function WelfareBoard({
  items,
  team,
}: {
  items: FollowupItem[];
  team: { id: string; full_name: string }[];
}) {
  const [reasonFilter, setReasonFilter] = useState<string>("all");

  const filtered = useMemo(
    () => (reasonFilter === "all" ? items : items.filter((i) => i.reason === reasonFilter)),
    [items, reasonFilter]
  );

  const counts = {
    all: items.length,
    new_member: items.filter((i) => i.reason === "new_member").length,
    missed_service: items.filter((i) => i.reason === "missed_service").length,
    traveled: items.filter((i) => i.reason === "traveled").length,
  };

  return (
    <div className="space-y-5">
      <Tabs
        value={reasonFilter}
        onValueChange={setReasonFilter}
        tabs={[
          { value: "all", label: "All", count: counts.all },
          { value: "new_member", label: "New members", count: counts.new_member },
          { value: "missed_service", label: "Missed service", count: counts.missed_service },
          { value: "traveled", label: "Traveled", count: counts.traveled },
        ]}
      />

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--text-muted)]">
            Nothing to follow up on right now.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((item) => (
            <FollowupCard key={item.id} item={item} team={team} />
          ))}
        </div>
      )}
    </div>
  );
}

function FollowupCard({
  item,
  team,
}: {
  item: FollowupItem;
  team: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const [level, setLevel] = useState(item.level);
  const [status, setStatus] = useState<WelfareStatus>(item.status);
  const [assignedTo, setAssignedTo] = useState<string>(item.assignedTo ?? "");
  const [notes, setNotes] = useState(item.notes);
  const [busy, setBusy] = useState(false);

  async function save(extra?: { markContacted?: boolean; status?: WelfareStatus }) {
    setBusy(true);
    try {
      await updateFollowup(item.id, {
        level,
        status: extra?.status ?? status,
        notes,
        assignedTo: assignedTo || null,
        markContacted: extra?.markContacted,
      });
      toast({ title: "Saved", variant: "success" });
      router.refresh();
    } catch (e) {
      toast({ title: "Save failed", description: String(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  const subtitle =
    item.reason === "missed_service" && item.missedCount
      ? `Missed ${item.missedCount} service${item.missedCount === 1 ? "" : "s"}`
      : `Flagged ${relative(item.createdAt)}`;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">{item.memberName}</p>
            <p className="text-xs text-[var(--text-muted)]">{subtitle}</p>
          </div>
          <Badge
            variant={
              item.reason === "missed_service"
                ? "warning"
                : item.reason === "new_member"
                ? "default"
                : "neutral"
            }
          >
            {REASON_LABEL[item.reason]}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-[var(--text-muted)]">Level</label>
            <div className="flex gap-1">
              {[1, 2, 3].map((l) => (
                <button
                  key={l}
                  onClick={() => setLevel(l)}
                  className={cn(
                    "h-9 flex-1 rounded-lg border text-sm transition-colors",
                    level === l
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "border-[var(--border)] hover:bg-[var(--bg)]"
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-[var(--text-muted)]">Status</label>
            <Select value={status} onChange={(e) => setStatus(e.target.value as WelfareStatus)} className="h-9">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-[var(--text-muted)]">Assigned to</label>
          <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="h-9">
            <option value="">Unassigned</option>
            {team.map((t) => (
              <option key={t.id} value={t.id}>
                {t.full_name}
              </option>
            ))}
          </Select>
        </div>

        <Textarea
          placeholder="Notes…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-16"
        />

        {item.lastContactAt && (
          <p className="text-xs text-[var(--text-muted)]">
            Last contact: {new Date(item.lastContactAt).toLocaleDateString()}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => save()} disabled={busy}>
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => save({ markContacted: true, status: "contacted" })}
            disabled={busy}
          >
            <Check className="h-4 w-4" /> Mark contacted
          </Button>
          {item.whatsapp && (
            <a
              href={buildWhatsAppLink(item.whatsapp, `Hello ${item.memberName}, checking in from the media team.`)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button size="sm" variant="ghost">
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </Button>
            </a>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => save({ status: "resolved" })}
            disabled={busy}
          >
            Resolve
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
