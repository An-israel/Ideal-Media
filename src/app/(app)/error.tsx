"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * What a member sees when a page throws.
 *
 * Without this file Next shows its own production screen — "Application error:
 * a server-side exception has occurred" on a white page, with the sidebar gone
 * and no way back. That screen is identical for a missing migration, a network
 * blip and a real bug, which has cost real time on this project. This keeps the
 * navigation, offers a retry, and shows the reference that matches the server
 * log line so a report of it can actually be traced.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] page error:", error);
  }, [error]);

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <AlertTriangle className="h-8 w-8 text-[var(--warning)]" />
        <h1 className="text-lg font-semibold">This page couldn&apos;t load</h1>
        <p className="max-w-md text-sm text-[var(--text-muted)]">
          Something went wrong on our side, not yours. Nothing you entered elsewhere has been
          lost. Try again — and if it keeps happening, send the reference below to the admin.
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-[var(--text-muted)]">Reference: {error.digest}</p>
        )}
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button onClick={reset}>
            <RotateCcw className="h-4 w-4" /> Try again
          </Button>
          <Link href="/dashboard">
            <Button variant="outline">Back to the dashboard</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
