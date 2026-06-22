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
import { importMembers, type ImportResult } from "./actions";

export function ImportMembersForm({ subunits }: { subunits: { id: string; name: string }[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [defaultSubunitId, setDefaultSubunitId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file && !sheetUrl.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const fd = new FormData();
      if (sheetUrl.trim()) fd.set("sheetUrl", sheetUrl.trim());
      else if (file) fd.set("file", file);
      if (defaultSubunitId) fd.set("defaultSubunitId", defaultSubunitId);
      const res = await importMembers(fd);
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
            <Label>Member spreadsheet</Label>
            <SheetSource file={file} setFile={setFile} sheetUrl={sheetUrl} setSheetUrl={setSheetUrl} />
          </div>
          <div className="space-y-2">
            <Label>Default subunit</Label>
            <Select value={defaultSubunitId} onChange={(e) => setDefaultSubunitId(e.target.value)}>
              <option value="">— use the sheet&apos;s subunit column —</option>
              {subunits.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-[var(--text-muted)]">
              Used for rows with no subunit in the sheet (e.g. a single unit&apos;s list).
            </p>
          </div>
          <Button type="submit" disabled={loading || (!file && !sheetUrl.trim())}>
            <Upload className="h-4 w-4" />
            {loading ? "Importing…" : "Import members"}
          </Button>
        </form>

        {result && (
          <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
            {result.error ? (
              <p className="text-sm font-medium text-[var(--danger)]">{result.error}</p>
            ) : (
              <p className="flex items-center gap-2 text-sm font-medium text-[var(--success)]">
                <CheckCircle2 className="h-4 w-4" />
                Created {result.created} member{result.created === 1 ? "" : "s"}.
              </p>
            )}
            {result.skipped.length > 0 && (
              <div>
                <p className="text-sm font-medium">
                  Skipped {result.skipped.length} row{result.skipped.length === 1 ? "" : "s"}:
                </p>
                <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto text-sm text-[var(--text-muted)]">
                  {result.skipped.map((s, i) => (
                    <li key={i}>
                      Row {s.row} — {s.name}: {s.reason}
                    </li>
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
