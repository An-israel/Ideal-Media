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

/**
 * Downscale a photo to ~1600px in the browser before upload so it stays small
 * and reliable for the vision model. Spreadsheets pass through untouched.
 */
async function maybeShrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const maxDim = 1600;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
    const blob: Blob | null = await new Promise((res) =>
      canvas.toBlob((b) => res(b), "image/jpeg", 0.85)
    );
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
  } catch {
    return file; // if anything fails, send the original
  }
}

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
      const prepared = await maybeShrinkImage(file);
      const fd = new FormData();
      fd.set("file", prepared);
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
            <Label htmlFor="file">Sheet or photo</Label>
            <Input
              id="file"
              type="file"
              accept=".xlsx,.csv,image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
            <p className="text-xs text-[var(--text-muted)]">
              Upload a <b>.xlsx/.csv</b> spreadsheet, or <b>snap/upload a photo</b> of a
              paper register — on a phone you can take the picture right here. 📸
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={loading || !file}>
            <Upload className="h-4 w-4" />
            {loading ? "Reading with AI…" : "Upload & read"}
          </Button>
          <p className="text-xs text-[var(--text-muted)]">
            The AI reads it and maps names to your roster. Nothing is saved to attendance
            until you review and commit.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
