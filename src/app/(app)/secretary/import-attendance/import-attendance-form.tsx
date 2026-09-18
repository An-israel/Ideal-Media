"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SheetSource } from "@/components/app/sheet-source";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { importPastAttendance, importWideAttendance, type AttendanceImportResult } from "./actions";

export function ImportAttendanceForm({ activities }: { activities: { id: string; name: string }[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"long" | "wide">("long");
  const [activityId, setActivityId] = useState(activities[0]?.id ?? "");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [file, setFile] = useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  // Blanks in a register aren't always an absence — some registers only mark
  // attendance (AUDIT ATT-4).
  const [blankPolicy, setBlankPolicy] = useState<"absent" | "skip">("absent");
  // Historical imports shouldn't manufacture present-day welfare follow-ups.
  const [runWelfare, setRunWelfare] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AttendanceImportResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if ((!file && !sheetUrl.trim()) || !activityId) return;
    setLoading(true);
    setResult(null);
    try {
      const fd = new FormData();
      if (sheetUrl.trim()) fd.set("sheetUrl", sheetUrl.trim());
      else if (file) fd.set("file", file);
      fd.set("activityId", activityId);
      fd.set("year", year);
      fd.set("blankPolicy", blankPolicy);
      if (runWelfare) fd.set("runWelfare", "on");
      const res = mode === "wide" ? await importWideAttendance(fd) : await importPastAttendance(fd);
      setResult(res);
      router.refresh();
    } catch (err) {
      toast({ title: "Import failed", description: String(err), variant: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label>Sheet layout</Label>
            <div className="flex w-max gap-1 rounded-lg border border-[var(--border)] p-1 text-sm">
              <button
                type="button"
                onClick={() => setMode("long")}
                className={cn("rounded-md px-3 py-1.5", mode === "long" ? "bg-[var(--accent)] text-[var(--accent-foreground)]" : "text-[var(--text-muted)]")}
              >
                One row per record
              </button>
              <button
                type="button"
                onClick={() => setMode("wide")}
                className={cn("rounded-md px-3 py-1.5", mode === "wide" ? "bg-[var(--accent)] text-[var(--accent-foreground)]" : "text-[var(--text-muted)]")}
              >
                Register (dates across the top)
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{mode === "wide" ? "Default activity (for undated/unlabeled columns)" : "Activity"}</Label>
            <Select value={activityId} onChange={(e) => setActivityId(e.target.value)}>
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>

          {mode === "wide" && (
            <div className="space-y-2">
              <Label>Year of these services</Label>
              <Input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="w-28"
              />
              <p className="text-xs text-[var(--text-muted)]">
                Column headers like “SUN 30/11” have no year — this is added. SUN columns →
                Sunday Service, WED → Bible Study; others use the default activity.
                Month-name columns (e.g. “MARCH”) are read as that month&apos;s attendance
                count and saved as a monthly tally.
              </p>
            </div>
          )}

          {mode === "wide" && (
            <div className="space-y-2">
              <Label>Blank cells mean</Label>
              <Select
                value={blankPolicy}
                onChange={(e) => setBlankPolicy(e.target.value as "absent" | "skip")}
              >
                <option value="absent">The person was absent</option>
                <option value="skip">Nothing — don&apos;t record anything</option>
              </Select>
              <p className="text-xs text-[var(--text-muted)]">
                Choose <b>nothing</b> if your register only ticks who attended. Recording
                blanks as absences for dates before someone joined drags their attendance
                rate down and can flag them to welfare unfairly.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Attendance spreadsheet</Label>
            <SheetSource file={file} setFile={setFile} sheetUrl={sheetUrl} setSheetUrl={setSheetUrl} />
            <p className="text-xs text-[var(--text-muted)]">
              Every tab in the workbook is read — a file with one sheet per month imports all
              of them.
            </p>
          </div>

          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={runWelfare}
              onChange={(e) => setRunWelfare(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[var(--border)]"
            />
            <span>
              Update welfare follow-ups from this import
              <span className="block text-xs text-[var(--text-muted)]">
                Leave this off for old records. Turn it on only when the sheet covers the most
                recent services, or people who have since returned may be flagged.
              </span>
            </span>
          </label>
          <Button type="submit" disabled={loading || (!file && !sheetUrl.trim())}>
            <Upload className="h-4 w-4" />
            {loading ? "Importing…" : "Import attendance"}
          </Button>
        </form>

        {result?.error && (
          <div className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-4 text-sm text-[var(--danger)]">
            {result.error}
          </div>
        )}

        {result && !result.error && (
          <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-[var(--success)]">
              <CheckCircle2 className="h-4 w-4" />
              Imported {result.imported} record{result.imported === 1 ? "" : "s"}
              {result.summaries ? ` and ${result.summaries} monthly tall${result.summaries === 1 ? "y" : "ies"}` : ""}.
            </p>
            {result.sheets && result.sheets.length > 0 && (
              <p className="text-xs text-[var(--text-muted)]">
                Read {result.sheets.length} sheet{result.sheets.length === 1 ? "" : "s"}:{" "}
                {result.sheets.join(", ")}.
              </p>
            )}
            {result.skipped.length > 0 && (
              <div>
                <p className="text-sm font-medium">
                  Skipped {result.skipped.length} row{result.skipped.length === 1 ? "" : "s"}:
                </p>
                <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto text-sm text-[var(--text-muted)]">
                  {result.skipped.map((s, i) => (
                    <li key={i}>Row {s.row}: {s.reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
