"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Archive, Undo2, Link2, Copy } from "lucide-react";
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
  restoreMembers,
  createClaimLink,
  assignSubunit,
  moveToSubunit,
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
  /** Access removed: off every roll, history kept, restorable. */
  archived: boolean;
};

/** Shown as the subunit of a member who has no primary one yet. */
export const UNASSIGNED = "No subunit yet";

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

  const [claimLink, setClaimLink] = useState<{ name: string; url: string; days: number } | null>(
    null
  );

  async function makeClaimLink(userId: string) {
    setBusy(true);
    try {
      const res = await createClaimLink(userId);
      if (!res.ok) {
        toast({ title: "No link made", description: res.error, variant: "error" });
        return;
      }
      setClaimLink({
        name: res.name,
        url: `${window.location.origin}/signup?claim=${res.token}`,
        days: res.days,
      });
    } finally {
      setBusy(false);
    }
  }

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
          // Archived members are a separate view: they are off the roll, so
          // they do not belong in a list somebody is about to bulk-edit.
          (statusFilter === "archived"
            ? r.archived
            : !r.archived &&
              (statusFilter === "all" ||
                (statusFilter === "unassigned"
                  ? r.subunit === UNASSIGNED
                  : r.status === statusFilter))) &&
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

  async function applyMoveSubunit() {
    if (selected.size === 0 || !bulkSubunit) return;
    setBusy(true);
    try {
      const res = await moveToSubunit([...selected], bulkSubunit);
      const name = subunits.find((s) => s.id === bulkSubunit)?.name ?? "subunit";
      toast({
        title: `Moved ${res.moved} member(s) to ${name}`,
        description: res.skipped ? `${res.skipped} already had ${name} as their main subunit.` : undefined,
        variant: "success",
      });
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      toast({ title: "Could not move", description: String(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function applyArchive() {
    if (selected.size === 0) return;
    if (
      !window.confirm(
        `Archive ${selected.size} member(s)? They will no longer be able to sign in and will come off every roster. Nothing is deleted — their history is kept and you can restore them from the "Archived" filter.`
      )
    )
      return;
    setBusy(true);
    try {
      const { removed, failed } = await removeMembers([...selected]);
      if (removed > 0) {
        toast({ title: `Archived ${removed} member(s)`, variant: "success" });
      }
      if (failed.length > 0) {
        toast({
          title: `Could not archive ${failed.length} member(s)`,
          description: failed.map((f) => `${f.name}: ${f.reason}`).join("; "),
          variant: "error",
        });
      }
      if (removed === 0 && failed.length === 0) {
        toast({ title: "Nothing was archived", variant: "error" });
      }
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      toast({
        title: "Could not archive",
        description: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function applyRestore() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const { removed: restored, failed } = await restoreMembers([...selected]);
      if (restored > 0) {
        toast({ title: `Restored ${restored} member(s)`, variant: "success" });
      }
      if (failed.length > 0) {
        toast({
          title: `${failed.length} could not be fully restored`,
          description: failed.map((f) => `${f.name}: ${f.reason}`).join("; "),
          variant: "error",
        });
      }
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      toast({
        title: "Could not restore",
        description: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
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
      const res = await addMemberToRoster(addForm);
      if (!res.ok) {
        toast({ title: "Could not add member", description: res.error, variant: "error" });
        return;
      }
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
        <Select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            // A selection made under one filter must not be acted on under
            // another, where different rows — and a different button — show.
            setSelected(new Set());
          }}
          className="w-44"
        >
          <option value="all">All statuses</option>
          <option value="unassigned">No subunit yet</option>
          <option value="archived">Archived ({rows.filter((r) => r.archived).length})</option>
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
              <span className="ml-2 text-sm text-[var(--text-muted)]">Subunit</span>
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
              <Button size="sm" variant="secondary" onClick={applyMoveSubunit} disabled={busy} title="Change their main subunit">
                Move here
              </Button>
              <Button size="sm" variant="ghost" onClick={applyAssignSubunit} disabled={busy} title="Add as an extra subunit (keeps their main one)">
                Add as extra
              </Button>
            </>
          )}

          {statusFilter === "archived" ? (
            <Button size="sm" className="ml-auto" onClick={applyRestore} disabled={busy}>
              <Undo2 className="h-4 w-4" />
              Restore
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-[var(--danger)]"
              onClick={applyArchive}
              disabled={busy}
              title="Stops them signing in and takes them off the roll. Nothing is deleted."
            >
              <Archive className="h-4 w-4" />
              Archive
            </Button>
          )}
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
                <span
                  className={
                    r.subunit === UNASSIGNED
                      ? "hidden truncate font-medium text-[var(--warning)] sm:block"
                      : "hidden truncate text-[var(--text-muted)] sm:block"
                  }
                >
                  {r.subunit}
                </span>
                <span className="flex items-center gap-2">
                  {!r.claimed && !r.archived && (
                    <button
                      type="button"
                      onClick={() => makeClaimLink(r.id)}
                      disabled={busy}
                      title="They have not signed up yet. Make a link that attaches their sign-up to this record."
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                    >
                      <Link2 className="h-3 w-3" /> Claim link
                    </button>
                  )}
                  <Badge variant={r.origin === "self_signup" ? "success" : "neutral"}>
                    {ORIGIN_LABEL[r.origin] ?? r.origin}
                  </Badge>
                </span>
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
        open={claimLink !== null}
        onClose={() => setClaimLink(null)}
        title={claimLink ? `Claim link for ${claimLink.name}` : "Claim link"}
        description="Send this to them and nobody else. When they sign up through it, their account is attached to this record — unit, attendance and all."
      >
        {claimLink && (
          <div className="space-y-4">
            <Input readOnly value={claimLink.url} onFocus={(e) => e.currentTarget.select()} />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(claimLink.url);
                    toast({ title: "Link copied", variant: "success" });
                  } catch {
                    toast({
                      title: "Couldn't copy",
                      description: "Select the link above and copy it by hand.",
                      variant: "error",
                    });
                  }
                }}
              >
                <Copy className="h-4 w-4" /> Copy link
              </Button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(
                  `Hi ${claimLink.name.split(" ")[0]}, here is your link to join the Ideal Media platform. It is yours alone — please don't forward it: ${claimLink.url}`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline">Send on WhatsApp</Button>
              </a>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Works once, and for {claimLink.days} days. Making another link for the same person
              cancels this one — so if it goes to the wrong number, just make a new one.
            </p>
          </div>
        )}
      </Dialog>

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
