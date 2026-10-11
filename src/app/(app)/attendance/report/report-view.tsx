"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import type { SubunitBreakdownRow } from "@/lib/attendance-report";

export function ReportView({
  services,
  activityId,
  serviceDate,
  reportText,
  breakdownText,
  missingSubunits,
  unassigned,
  totals,
  subunits,
}: {
  services: { id: string; name: string; date: string }[];
  activityId: string;
  serviceDate: string;
  reportText: string;
  breakdownText: string;
  missingSubunits: string[];
  unassigned: string[];
  totals: { total: number; present: number; absent: number; onIt: number };
  subunits: SubunitBreakdownRow[];
}) {
  const router = useRouter();
  const [copied, setCopied] = useState<"report" | "breakdown" | null>(null);

  async function copy(text: string, which: "report" | "breakdown") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access can be refused (insecure context, permissions). The
      // text is on screen and selectable, so say so rather than failing mutely.
      toast({
        title: "Couldn't copy automatically",
        description: "Select the text below and copy it by hand.",
        variant: "error",
      });
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 py-4">
          <div className="min-w-[14rem] flex-1 space-y-1">
            <label htmlFor="svc" className="text-xs text-[var(--text-muted)]">
              Service
            </label>
            <Select
              id="svc"
              value={`${activityId}|${serviceDate}`}
              onChange={(e) => {
                const [a, d] = e.target.value.split("|");
                router.push(`/attendance/report?activity=${a}&date=${d}`);
              }}
            >
              {services.map((s) => (
                <option key={s.id} value={`${s.id}|${s.date}`}>
                  {s.name} — {s.date}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex gap-6">
            <Stat label="Total" value={totals.total} />
            <Stat label="Present" value={totals.present} tone="success" />
            <Stat label="Absent" value={totals.absent} tone="danger" />
            {totals.onIt > 0 && <Stat label="On IT" value={totals.onIt} />}
          </div>
        </CardContent>
      </Card>

      {missingSubunits.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-3 text-sm text-[var(--warning)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {missingSubunits.length}{" "}
            {missingSubunits.length === 1 ? "subunit has" : "subunits have"} not submitted:{" "}
            <strong>{missingSubunits.join(", ")}</strong>. Their members are counted absent with
            no reason until they do.
          </span>
        </p>
      )}

      {unassigned.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-3 text-sm text-[var(--warning)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {unassigned.length}{" "}
            {unassigned.length === 1 ? "person is" : "people are"} on the roll but no subunit
            reports on them, so they are in nobody&apos;s count:{" "}
            <strong>{unassigned.slice(0, 8).join(", ")}</strong>
            {unassigned.length > 8 && ` and ${unassigned.length - 8} more`}. Give them a primary
            subunit in Secretary → Roster.
          </span>
        </p>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">The message</CardTitle>
          <Button size="sm" onClick={() => copy(reportText, "report")}>
            {copied === "report" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied === "report" ? "Copied" : "Copy"}
          </Button>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 text-sm leading-relaxed">
            {reportText}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Subunit breakdown</CardTitle>
          <Button size="sm" variant="outline" onClick={() => copy(breakdownText, "breakdown")}>
            {copied === "breakdown" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied === "breakdown" ? "Copied" : "Copy"}
          </Button>
        </CardHeader>
        <CardContent className="divide-y divide-[var(--border)] p-0">
          {subunits.map((s) => {
            const pct = s.total > 0 ? Math.round((s.present / s.total) * 100) : 0;
            return (
              <div key={s.subunitName} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{s.subunitName}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {s.noService
                      ? "No service held"
                      : s.submitted
                        ? `${s.present} of ${s.total} present (${pct}%)`
                        : `${s.total} members — nothing recorded`}
                  </p>
                </div>
                {s.noService ? (
                  <Badge variant="neutral">No service</Badge>
                ) : !s.submitted ? (
                  <Badge variant="danger">Not submitted</Badge>
                ) : s.late ? (
                  <Badge variant="warning">Late</Badge>
                ) : (
                  <Badge variant="success">On time</Badge>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
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
  tone?: "success" | "danger";
}) {
  const color =
    tone === "success"
      ? "text-[var(--success)]"
      : tone === "danger"
        ? "text-[var(--danger)]"
        : "";
  return (
    <div>
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className={`text-2xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}
