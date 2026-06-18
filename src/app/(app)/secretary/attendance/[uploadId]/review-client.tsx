"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { commitUpload, discardUpload } from "../actions";
import type { AiProposal, AttendanceStatus } from "@/lib/database.types";

const STATUSES: AttendanceStatus[] = ["present", "absent", "traveled", "excused"];

type RosterMember = { id: string; full_name: string };

function StatusSelect({
  value,
  onChange,
}: {
  value: AttendanceStatus;
  onChange: (v: AttendanceStatus) => void;
}) {
  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value as AttendanceStatus)}
      className="h-9 w-32"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </Select>
  );
}

export function ReviewClient({
  uploadId,
  proposal,
  roster,
}: {
  uploadId: string;
  proposal: AiProposal;
  roster: RosterMember[];
}) {
  const router = useRouter();
  const nameById = new Map(roster.map((r) => [r.id, r.full_name]));

  const [matches, setMatches] = useState(
    proposal.matches.map((m) => ({ ...m }))
  );
  const [unmatched, setUnmatched] = useState(
    proposal.unmatched_sheet_rows.map((u) => ({
      name_on_sheet: u.name_on_sheet,
      mappedTo: "" as string, // roster id or "" (ignore)
      status: "present" as AttendanceStatus,
    }))
  );
  const [notOnSheet, setNotOnSheet] = useState(
    proposal.roster_not_on_sheet.map((r) => ({
      roster_id: r.roster_id,
      full_name: r.full_name || nameById.get(r.roster_id) || "Member",
      status: "absent" as AttendanceStatus,
    }))
  );
  const [busy, setBusy] = useState(false);

  async function commit() {
    setBusy(true);
    // Assemble final decisions, de-duplicated by user (later wins).
    const map = new Map<string, AttendanceStatus>();
    for (const m of matches) map.set(m.roster_id, m.status);
    for (const u of unmatched) if (u.mappedTo) map.set(u.mappedTo, u.status);
    for (const r of notOnSheet) if (!map.has(r.roster_id)) map.set(r.roster_id, r.status);

    const decisions = [...map.entries()].map(([userId, status]) => ({ userId, status }));
    try {
      await commitUpload(uploadId, decisions);
      toast({ title: "Attendance committed", variant: "success" });
      router.push("/secretary/attendance");
    } catch (e) {
      toast({ title: "Commit failed", description: String(e), variant: "error" });
      setBusy(false);
    }
  }

  async function discard() {
    setBusy(true);
    try {
      await discardUpload(uploadId);
      router.push("/secretary/attendance");
    } catch (e) {
      toast({ title: "Could not discard", description: String(e), variant: "error" });
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Matched */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Matched ({matches.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {matches.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">No automatic matches.</p>
          )}
          {matches.map((m, i) => {
            const lowConf = m.confidence < 0.7;
            return (
              <div
                key={i}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5",
                  lowConf ? "border-[var(--warning)]/40 bg-[var(--warning)]/5" : "border-[var(--border)]"
                )}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {nameById.get(m.roster_id) ?? "Unknown member"}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    sheet: “{m.name_on_sheet}”
                    {lowConf && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[var(--warning)]">
                        <AlertTriangle className="h-3 w-3" /> low confidence
                      </span>
                    )}
                  </p>
                </div>
                <StatusSelect
                  value={m.status}
                  onChange={(v) =>
                    setMatches((arr) => arr.map((x, j) => (j === i ? { ...x, status: v } : x)))
                  }
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Unmatched sheet rows */}
      {unmatched.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Unmatched sheet names ({unmatched.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {unmatched.map((u, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3.5 py-2.5"
              >
                <p className="min-w-0 text-sm font-medium">“{u.name_on_sheet}”</p>
                <div className="flex items-center gap-2">
                  <Select
                    value={u.mappedTo}
                    onChange={(e) =>
                      setUnmatched((arr) =>
                        arr.map((x, j) => (j === i ? { ...x, mappedTo: e.target.value } : x))
                      )
                    }
                    className="h-9 w-48"
                  >
                    <option value="">Ignore</option>
                    {roster.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.full_name}
                      </option>
                    ))}
                  </Select>
                  <StatusSelect
                    value={u.status}
                    onChange={(v) =>
                      setUnmatched((arr) => arr.map((x, j) => (j === i ? { ...x, status: v } : x)))
                    }
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Roster members not on the sheet */}
      {notOnSheet.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Roster not on sheet ({notOnSheet.length}) — default absent
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {notOnSheet.map((r, i) => (
              <div
                key={r.roster_id}
                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3.5 py-2.5"
              >
                <p className="text-sm font-medium">{r.full_name}</p>
                <StatusSelect
                  value={r.status}
                  onChange={(v) =>
                    setNotOnSheet((arr) => arr.map((x, j) => (j === i ? { ...x, status: v } : x)))
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={commit} disabled={busy}>
          {busy ? "Committing…" : "Commit attendance"}
        </Button>
        <Button variant="outline" onClick={discard} disabled={busy}>
          Discard
        </Button>
        <Badge variant="neutral">Nothing is saved until you commit</Badge>
      </div>
    </div>
  );
}
