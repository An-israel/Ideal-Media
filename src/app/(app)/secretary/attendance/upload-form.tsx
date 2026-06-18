"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { createAndParseUpload } from "./actions";

export function UploadForm({ activities }: { activities: { id: string; name: string }[] }) {
  const router = useRouter();
  const [activityId, setActivityId] = useState(activities[0]?.id ?? "");
  const [serviceDate, setServiceDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !activityId || !serviceDate) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("activityId", activityId);
      fd.set("serviceDate", serviceDate);
      const { uploadId } = await createAndParseUpload(fd);
      router.push(`/secretary/attendance/${uploadId}`);
    } catch (err) {
      toast({ title: "Upload failed", description: String(err), variant: "error" });
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New upload</CardTitle>
      </CardHeader>
      <CardContent>
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
            <Label htmlFor="date">Service date</Label>
            <Input
              id="date"
              type="date"
              value={serviceDate}
              onChange={(e) => setServiceDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="file">Sheet (.xlsx or .csv)</Label>
            <Input
              id="file"
              type="file"
              accept=".xlsx,.csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading || !file}>
            <Upload className="h-4 w-4" />
            {loading ? "Parsing with AI…" : "Upload & parse"}
          </Button>
          <p className="text-xs text-[var(--text-muted)]">
            The file is parsed and mapped to your roster by AI. Nothing is written to
            attendance until you review and commit.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
