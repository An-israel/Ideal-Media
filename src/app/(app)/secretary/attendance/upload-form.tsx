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
  // Several files so a multi-page paper register is one upload (AUDIT ATT-9).
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0 || !activityId || !serviceDate) return;
    setLoading(true);
    try {
      const prepared = await Promise.all(files.map(maybeShrinkImage));
      const fd = new FormData();
      for (const f of prepared) fd.append("file", f);
      fd.set("activityId", activityId);
      fd.set("serviceDate", serviceDate);
      const { uploadId, parseError } = await createAndParseUpload(fd);
      // Automatic reading can fail while the upload itself succeeds. Say so,
      // rather than dropping the secretary onto an empty review screen with no
      // explanation (AUDIT ATT-2).
      if (parseError) {
        toast({
          title: "Couldn't read it automatically",
          description: `${parseError} You can still map names by hand below.`,
          variant: "error",
        });
      }
      router.push(`/secretary/attendance/${uploadId}`);
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
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
            <Label htmlFor="file">Sheet or photo(s)</Label>
            <Input
              id="file"
              type="file"
              multiple
              accept=".xlsx,.csv,image/*"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              required
            />
            <p className="text-xs text-[var(--text-muted)]">
              Upload a <b>.xlsx/.csv</b> spreadsheet (every tab is read), or{" "}
              <b>snap/upload photos</b> of a paper register — on a phone you can take the
              pictures right here. 📸 Multi-page register? Select all the pages at once.
            </p>
            {files.length > 1 && (
              <p className="text-xs text-[var(--text-muted)]">
                {files.length} files selected.
              </p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={loading || files.length === 0}>
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
