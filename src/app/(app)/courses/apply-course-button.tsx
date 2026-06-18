"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { applyForCourse } from "./actions";

export function ApplyCourseButton({
  courseId,
  courseTitle,
}: {
  courseId: string;
  courseTitle: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!reason.trim()) return;
    setLoading(true);
    try {
      await applyForCourse(courseId, reason);
      setOpen(false);
      setReason("");
      toast({ title: "Application sent", description: "Your leader will review it.", variant: "success" });
      router.refresh();
    } catch (e) {
      toast({ title: "Could not apply", description: String(e), variant: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
        Apply
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Apply for ${courseTitle}`}
        description="Tell your leader why you'd like to take this course."
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Why do you want to take this course?</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button className="w-full" onClick={submit} disabled={loading || !reason.trim()}>
            {loading ? "Sending…" : "Submit application"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
