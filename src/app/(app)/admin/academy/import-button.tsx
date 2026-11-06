"use client";

import { useState, useTransition } from "react";
import { Loader2, Download } from "lucide-react";
import { runAcademyImport } from "./actions";
import { toast } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import type { ImportResult } from "@/lib/academy-import";

export function ImportButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);

  return (
    <div>
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              const r = await runAcademyImport();
              setResult(r);
              toast({
                title: r.errors.length ? "Imported with problems" : "Imported",
                description: `${r.courses.inserted} added, ${r.courses.updated} updated.`,
                variant: r.errors.length ? "error" : "success",
              });
            } catch (e) {
              toast({
                title: "Import failed",
                description: e instanceof Error ? e.message : "Please try again.",
                variant: "error",
              });
            }
          })
        }
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {pending ? "Importing…" : "Import the courses"}
      </Button>

      {result && (
        <div className="mt-4 rounded-lg border border-[var(--border)] p-4 text-sm">
          <p>
            {result.courses.inserted} courses added, {result.courses.updated} updated.{" "}
            {result.modules} modules, {result.lessons} lessons and {result.assignments}{" "}
            assignments written.
          </p>
          {(result.removed.modules > 0 ||
            result.removed.lessons > 0 ||
            result.removed.assignments > 0) && (
            <p className="mt-1 text-[var(--text-muted)]">
              Removed {result.removed.modules} modules, {result.removed.lessons} lessons and{" "}
              {result.removed.assignments} assignments that are no longer in the course files.
            </p>
          )}
          {result.errors.length > 0 && (
            <ul className="mt-2 space-y-1 text-[var(--danger)]">
              {result.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
