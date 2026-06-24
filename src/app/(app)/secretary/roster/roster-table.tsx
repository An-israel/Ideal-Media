"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { MEMBER_STATUSES } from "@/lib/constants";
import {
  setMemberStatus,
  addMemberToRoster,
  removeMembers,
  assignSubunit,
} from "./actions";
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
  secretary: "By secretary",
};

const STATUS_VARIANT: Record<MemberStatus, "success" | "neutral" | "warning" | "danger"> = {
  active: "success",
  inactive: "neutral",
  traveled: "warning",
  graduated: "neutral",
  left: "danger",
};

export function RosterTable({
  rows,
  subunits,
}: {
  rows: RosterRow[];
  subunits: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<MemberStatus>("active");
  const [bulkSubunit, setBulkSubunit] = useState<string>(subunits[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({
    fullName: "",
    whatsappNumber: "",
    phone: "",
    email: "",
    primarySubunitId: subunits[0]?.id ?? "",
  });

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

  async function applyBulkStatus() {
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

  async function applyAssignSubunit() {
    if (selected.size === 0 || !bulkSubunit) return;
    setBusy(true);
    try {
      const res = await assignSubunit([...selected], bulkSubunit);
      const name = subunits.find((s) => s.id === bulkSubunit)?.name ?? "subunit";
      toast({
        title: `Added ${res.added} member(s) to ${name}`,
        description: res.skipped ? `${res.skipped} skipped (already there or at the 4-subunit limit).` : undefined,
        variant: "success",
      });
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      toast({ title: "Could not assign", description: String(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function applyRemove() {
    if (selected.size === 0) return;
    if (
      !window.confirm(
        `Permanently remove ${selected.size} member(s)? This deletes their record, login, and history and cannot be undone.`
      )
    )
      return;
    setBusy(true);
    try {
      await removeMembers([...selected]);
      toast({ title: `Removed ${selected.size} member(s)`, variant: "success" });
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      toast({ title: "Could not remove", description: String(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function submitAdd() {
    if (!addForm.fullName.trim() || !addForm.primarySubunitId) {
      toast({ title: "Name and subunit are required", variant: "error" });
      return;
    }
    setBusy(true);
    try {
      await addMemberToRoster(addForm);
      toast({ title: "Member added to the roster", variant: "success" });
      setAdding(false);
      setAddForm({ fullName: "", whatsappNumber: "", phone: "", email: "", primarySubunitId: subunits[0]?.id ?? "" });
      router.refresh();
    } catch (e) {
      toast({ title: "Could not add member", description: String(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  const setAdd = (k: keyof typeof addForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setAddForm((f) => ({ ...f, [k]: e.target.value }));

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
        <Button className="ml-auto" onClick={() => setAdding(true)}>
          <UserPlus className="h-4 w-4" />
          Add member
        </Button>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-4 py-3">
          <span className="text-sm font-medium">{selected.size} selected</span>

          <span className="text-sm text-[var(--text-muted)]">Status</span>
          <Select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value as MemberStatus)}
            className="h-9 w-36"
          >
            {MEMBER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="secondary" onClick={applyBulkStatus} disabled={busy}>
            Apply
          </Button>

          {subunits.length > 0 && (
            <>
              <span className="ml-2 text-sm text-[var(--text-muted)]">Add to subunit</span>
              <Select
                value={bulkSubunit}
                onChange={(e) => setBulkSubunit(e.target.value)}
                className="h-9 w-44"
              >
                {subunits.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="secondary" onClick={applyAssignSubunit} disabled={busy}>
                Assign
              </Button>
            </>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-[var(--danger)]"
            onClick={applyRemove}
            disabled={busy}
          >
            <Trash2 className="h-4 w-4" />
            Remove
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

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a member"
        description="Adds them to the roster. They claim the record when they sign up with a matching phone or email."
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Full name</Label>
            <Input value={addForm.fullName} onChange={setAdd("fullName")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>WhatsApp</Label>
              <Input value={addForm.whatsappNumber} onChange={setAdd("whatsappNumber")} placeholder="+234…" />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={addForm.phone} onChange={setAdd("phone")} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Email (optional)</Label>
            <Input type="email" value={addForm.email} onChange={setAdd("email")} />
          </div>
          <div className="space-y-2">
            <Label>Primary subunit</Label>
            <Select
              value={addForm.primarySubunitId}
              onChange={(e) => setAddForm((f) => ({ ...f, primarySubunitId: e.target.value }))}
            >
              {subunits.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <Button className="w-full" onClick={submitAdd} disabled={busy || !addForm.fullName.trim()}>
            {busy ? "Adding…" : "Add member"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
