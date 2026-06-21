"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SheetSource } from "@/components/app/sheet-source";
import { toast } from "@/components/ui/toaster";
import { importPastAttendance, type AttendanceImportResult } from "./actions";

export function ImportAttendanceForm({ activities }: { activities: { id: string; name: string }[] }) {
  const router = useRouter();
  const [activityId, setActivityId] = useState(activities[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
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
      const res = await importPastAttendance(fd);
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
            <Label>Activity</Label>
            <Select value={activityId} onChange={(e) => setActivityId(e.target.value)}>
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Attendance spreadsheet</Label>
            <SheetSource file={file} setFile={setFile} sheetUrl={sheetUrl} setSheetUrl={setSheetUrl} />
          </div>
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
              Imported {result.imported} record{result.imported === 1 ? "" : "s"}.
            </p>
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
