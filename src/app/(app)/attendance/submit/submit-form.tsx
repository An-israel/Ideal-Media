"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Search, CalendarOff, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { ABSENCE_REASONS } from "@/lib/absence-reasons";
import { submitAttendance, markNoService, type AttendanceMark } from "../actions";
import type { AbsenceReason, AttendanceStatus } from "@/lib/database.types";

export interface FormMember {
  userId: string;
  fullName: string;
  memberStatus: string;
  status: AttendanceStatus;
  absenceReason: AbsenceReason | null;
  absenceNote: string | null;
}

export function SubmitForm({
  subunitId,
  activityId,
  serviceDate,
  members: initial,
  alreadySubmitted,
  noService,
  noServiceReason,
  overdue,
  locked,
}: {
  subunitId: string;
  activityId: string;
  serviceDate: string;
  members: FormMember[];
  alreadySubmitted: boolean;
  noService: boolean;
  noServiceReason: string;
  overdue: boolean;
  locked: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<FormMember[]>(initial);
  const [query, setQuery] = useState("");
  const [showNoService, setShowNoService] = useState(noService);
  const [noServiceText, setNoServiceText] = useState(noServiceReason);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.fullName.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  const presentCount = rows.filter((r) => r.status === "present").length;
  const absentCount = rows.length - presentCount;

  function update(userId: string, patch: Partial<FormMember>) {
    setRows((rs) => rs.map((r) => (r.userId === userId ? { ...r, ...patch } : r)));
  }

  function setAll(status: AttendanceStatus) {
    setRows((rs) =>
      rs.map((r) => ({
        ...r,
        status,
        absenceReason: status === "present" ? null : r.absenceReason,
        absenceNote: status === "present" ? null : r.absenceNote,
      }))
    );
  }

  function save() {
    const missing = rows.filter((r) => r.status !== "present" && !r.absenceReason);
    if (missing.length > 0) {
      toast({
        title: `${missing.length} ${missing.length === 1 ? "absence needs" : "absences need"} a reason`,
        description: missing
          .slice(0, 3)
          .map((m) => m.fullName)
          .join(", "),
        variant: "error",
      });
      return;
    }
    const marks: AttendanceMark[] = rows.map((r) => ({
      userId: r.userId,
      status: r.status,
      absenceReason: r.status === "present" ? null : r.absenceReason,
      absenceNote: r.status === "present" ? null : (r.absenceNote?.trim() || null),
    }));
    start(async () => {
      const res = await submitAttendance({ subunitId, activityId, serviceDate, marks });
      if (!res.ok) {
        toast({ title: "Not saved", description: res.error, variant: "error" });
        return;
      }
      toast({
        title: alreadySubmitted ? "Attendance updated" : "Attendance submitted",
        description: `${presentCount} present, ${absentCount} absent.`,
      });
      router.push("/attendance");
      router.refresh();
    });
  }

  function saveNoService() {
    start(async () => {
      const res = await markNoService({
        subunitId,
        activityId,
        serviceDate,
        reason: noServiceText,
      });
      if (!res.ok) {
        toast({ title: "Not saved", description: res.error, variant: "error" });
        return;
      }
      toast({ title: "Marked as no service", description: "Nobody was recorded absent." });
      router.push("/attendance");
      router.refresh();
    });
  }

  if (locked) {
    return (
      <Card>
        <CardContent className="space-y-2 py-8">
          <p className="text-sm font-medium">This submission is locked.</p>
          <p className="text-sm text-[var(--text-muted)]">
            The 8PM deadline for this service has passed and it has already been submitted.
            Ask the secretary or welfare to make a correction — they can still amend it, and
            the change is recorded against their name.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {overdue && (
        <div className="rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-3 text-sm text-[var(--warning)]">
          The deadline for this service has passed. You can still submit — it will be recorded
          as late.
        </div>
      )}

      {showNoService ? (
        <Card>
          <CardContent className="space-y-3 py-5">
            <p className="text-sm font-medium">No service this week</p>
            <p className="text-sm text-[var(--text-muted)]">
              Nobody is marked absent, no welfare follow-ups are opened, and the week shows as
              N/A in the report rather than as a missing submission.
            </p>
            <Input
              value={noServiceText}
              onChange={(e) => setNoServiceText(e.target.value)}
              placeholder="Reason (e.g. public holiday, church programme, camp)"
            />
            <div className="flex gap-2">
              <Button size="sm" disabled={pending} onClick={saveNoService}>
                <CalendarOff className="h-4 w-4" /> Confirm no service
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowNoService(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 py-4">
              <div>
                <p className="text-xs text-[var(--text-muted)]">This subunit</p>
                <p className="text-2xl font-semibold">
                  {presentCount}
                  <span className="text-base font-normal text-[var(--text-muted)]">
                    {" "}
                    / {rows.length} present
                  </span>
                </p>
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setAll("present")}>
                  <Check className="h-4 w-4" /> All present
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAll("absent")}>
                  <X className="h-4 w-4" /> All absent
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowNoService(true)}>
                  <CalendarOff className="h-4 w-4" /> No service
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Find someone in this list of ${rows.length}…`}
              className="pl-9"
            />
          </div>

          <Card>
            <CardContent className="divide-y divide-[var(--border)] p-0">
              {visible.length === 0 && (
                <p className="px-5 py-8 text-center text-sm text-[var(--text-muted)]">
                  {rows.length === 0
                    ? "Nobody has this subunit as their primary subunit yet."
                    : "No name matches that search."}
                </p>
              )}
              {visible.map((m) => {
                const away = m.status !== "present";
                return (
                  <div key={m.userId} className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{m.fullName}</p>
                        {m.memberStatus !== "active" && (
                          <Badge variant="neutral" className="mt-1">
                            {m.memberStatus}
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant={m.status === "present" ? "default" : "outline"}
                          onClick={() =>
                            update(m.userId, {
                              status: "present",
                              absenceReason: null,
                              absenceNote: null,
                            })
                          }
                        >
                          <Check className="h-4 w-4" /> Present
                        </Button>
                        <Button
                          size="sm"
                          variant={away ? "default" : "outline"}
                          onClick={() => update(m.userId, { status: "absent" })}
                        >
                          <X className="h-4 w-4" /> Absent
                        </Button>
                      </div>
                    </div>

                    {away && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Select
                          aria-label={`Reason ${m.fullName} was absent`}
                          value={m.absenceReason ?? ""}
                          onChange={(e) =>
                            update(m.userId, {
                              absenceReason: (e.target.value || null) as AbsenceReason | null,
                            })
                          }
                        >
                          <option value="">Why were they absent?</option>
                          {ABSENCE_REASONS.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </Select>
                        <Input
                          value={m.absenceNote ?? ""}
                          onChange={(e) => update(m.userId, { absenceNote: e.target.value })}
                          placeholder="What they said (optional)"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button disabled={pending || rows.length === 0} onClick={save}>
              <Save className="h-4 w-4" />
              {pending ? "Saving…" : alreadySubmitted ? "Save changes" : "Submit attendance"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
