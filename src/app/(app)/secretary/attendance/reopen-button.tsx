"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { reopenUpload } from "./actions";

/**
 * Reopens a committed upload for review (AUDIT ATT-11). A mis-committed sheet
 * previously had no correction path in the app at all — the only fix was
 * editing attendance_records directly in Supabase.
 */
export function ReopenButton({ uploadId, label }: { uploadId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function reopen() {
    if (
      !window.confirm(
        `Reopen "${label}" for review? The attendance it recorded will be removed until you commit again.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await reopenUpload(uploadId);
      toast({ title: "Reopened for review", variant: "success" });
      router.push(`/secretary/attendance/${uploadId}`);
    } catch (e) {
      toast({
        title: "Could not reopen",
        description: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="ghost" onClick={reopen} disabled={busy}>
      <Undo2 className="h-4 w-4" />
      {busy ? "Reopening…" : "Reopen"}
    </Button>
  );
}
