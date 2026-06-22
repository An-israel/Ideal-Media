"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { MEMBER_STATUSES } from "@/lib/constants";
import { setMemberStatus } from "./actions";
import type { MemberStatus } from "@/lib/database.types";

export type RosterRow = {
  id: string;
  name: string;
  status: MemberStatus;
  location: string | null;
  subunit: string;
  origin: string;
  claimed: boolean;
};

const ORIGIN_LABEL: Record<string, string> = {
  self_signup: "Joined",
  import: "Imported",
  welfare: "By welfare",
};

const STATUS_VARIANT: Record<MemberStatus, "success" | "neutral" | "warning" | "danger"> = {
  active: "success",
  inactive: "neutral",
  traveled: "warning",
  graduated: "neutral",
  left: "danger",
};

export function RosterTable({ rows }: { rows: RosterRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<MemberStatus>("active");
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (statusFilter === "all" || r.status === statusFilter) &&
          r.name.toLowerCase().includes(query.toLowerCase())
      ),
    [rows, query, statusFilter]
  );

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((s) =>
      s.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.id))
    );
  }

  async function applyBulk() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await setMemberStatus([...selected], bulkStatus);
      toast({ title: `Updated ${selected.size} member(s)`, variant: "success" });
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      toast({ title: "Update failed", description: String(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search members…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
          <option value="all">All statuses</option>
          {MEMBER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-4 py-3">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <span className="text-sm text-[var(--text-muted)]">Set status to</span>
          <Select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value as MemberStatus)}
            className="h-9 w-40"
          >
            {MEMBER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Button size="sm" onClick={applyBulk} disabled={busy}>
            Apply
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="grid grid-cols-[2rem_1.3fr_1fr_auto_auto] items-center gap-3 border-b border-[var(--border)] px-5 py-3 text-xs font-medium text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={filtered.length > 0 && selected.size === filtered.length}
              onChange={toggleAll}
              aria-label="Select all"
            />
            <span>Name</span>
            <span className="hidden sm:block">Subunit</span>
            <span className="hidden sm:block">How joined</span>
            <span>Status</span>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {filtered.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[2rem_1.3fr_1fr_auto_auto] items-center gap-3 px-5 py-3 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => toggle(r.id)}
                  aria-label={`Select ${r.name}`}
                />
                <div className="min-w-0">
                  <span className="block truncate font-medium">{r.name}</span>
                  {!r.claimed && (
                    <span className="text-xs text-[var(--text-muted)]">not signed up yet</span>
                  )}
                </div>
                <span className="hidden truncate text-[var(--text-muted)] sm:block">{r.subunit}</span>
                <Badge variant={r.origin === "self_signup" ? "success" : "neutral"}>
                  {ORIGIN_LABEL[r.origin] ?? r.origin}
                </Badge>
                <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="px-5 py-10 text-center text-sm text-[var(--text-muted)]">
                No members match.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
