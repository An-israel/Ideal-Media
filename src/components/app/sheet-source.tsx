"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Lets the user provide a spreadsheet either by uploading a file or by pasting
 * a Google Sheet link. The parent owns the `file` / `sheetUrl` state.
 */
export function SheetSource({
  setFile,
  sheetUrl,
  setSheetUrl,
}: {
  file: File | null;
  setFile: (f: File | null) => void;
  sheetUrl: string;
  setSheetUrl: (s: string) => void;
}) {
  const [mode, setMode] = useState<"file" | "link">("file");

  return (
    <div className="space-y-2">
      <div className="flex w-max gap-1 rounded-lg border border-[var(--border)] p-1 text-sm">
        <button
          type="button"
          onClick={() => {
            setMode("file");
            setSheetUrl("");
          }}
          className={cn(
            "rounded-md px-3 py-1.5 transition-colors",
            mode === "file" ? "bg-[var(--accent)] text-[var(--accent-foreground)]" : "text-[var(--text-muted)]"
          )}
        >
          Upload file
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("link");
            setFile(null);
          }}
          className={cn(
            "rounded-md px-3 py-1.5 transition-colors",
            mode === "link" ? "bg-[var(--accent)] text-[var(--accent-foreground)]" : "text-[var(--text-muted)]"
          )}
        >
          Google Sheet link
        </button>
      </div>

      {mode === "file" ? (
        <Input
          type="file"
          accept=".xlsx,.csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      ) : (
        <>
          <Input
            type="url"
            placeholder="https://docs.google.com/spreadsheets/…"
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value)}
          />
          <p className="text-xs text-[var(--text-muted)]">
            In Google Sheets: <b>Share → General access → “Anyone with the link” (Viewer)</b>,
            then paste the link.
          </p>
        </>
      )}
    </div>
  );
}
