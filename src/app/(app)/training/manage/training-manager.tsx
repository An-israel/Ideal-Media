"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Upload, Headphones, Video, ExternalLink, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import { formatDuration } from "@/lib/format";
import {
  ACCEPTED_TEACHING_AUDIO,
  ACCEPTED_TEACHING_VIDEO,
  MAX_TEACHING_UPLOAD_BYTES,
} from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import {
  createSeries,
  updateSeries,
  setSeriesPublished,
  deleteSeries,
  prepareTeachingUpload,
  publishAllTeachings,
  finalizeTeaching,
  updateTeaching,
  setTeachingPublished,
  deleteTeaching,
} from "./actions";
import type { TeachingMediaType } from "@/lib/database.types";

export interface ManagerTeaching {
  id: string;
  position: number;
  title: string;
  description: string | null;
  mediaType: TeachingMediaType;
  durationSeconds: number | null;
  isPublished: boolean;
}

export interface ManagerSeries {
  id: string;
  title: string;
  description: string | null;
  isPublished: boolean;
  teachings: ManagerTeaching[];
}

const MAX_MB = Math.round(MAX_TEACHING_UPLOAD_BYTES / (1024 * 1024));

export function TrainingManager({ series }: { series: ManagerSeries[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [addingSeries, setAddingSeries] = useState(false);
  const [newSeries, setNewSeries] = useState({ title: "", description: "" });

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      toast({ title: label, variant: "success" });
      router.refresh();
      return true;
    } catch (e) {
      toast({
        title: "Didn't work",
        description: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Manage teachings</h2>
        <Button size="sm" onClick={() => setAddingSeries((v) => !v)} disabled={busy}>
          <Plus className="h-4 w-4" /> New series
        </Button>
      </div>

      {addingSeries && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New series</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-[var(--text-muted)]">
              A series holds the parts of a teaching (Part 1, Part 2…). Create it first —
              then each series gets an <strong>Add a teaching</strong> button where you
              upload the MP3 or MP4.
            </p>
            <div className="space-y-2">
              <Label htmlFor="series-title">Title</Label>
              <Input
                id="series-title"
                value={newSeries.title}
                onChange={(e) => setNewSeries((s) => ({ ...s, title: e.target.value }))}
                placeholder="e.g. Essence of Media"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="series-desc">Description (optional)</Label>
              <Textarea
                id="series-desc"
                value={newSeries.description}
                onChange={(e) => setNewSeries((s) => ({ ...s, description: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy || !newSeries.title.trim()}
                onClick={async () => {
                  const ok = await run("Series created", () => createSeries(newSeries));
                  if (ok) {
                    setNewSeries({ title: "", description: "" });
                    setAddingSeries(false);
                  }
                }}
              >
                Create
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAddingSeries(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {series.length === 0 && !addingSeries && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-[var(--text-muted)]">
            No series yet. Create one, then add the teachings to it.
          </CardContent>
        </Card>
      )}

      {series.map((s) => (
        <SeriesCard key={s.id} series={s} busy={busy} run={run} />
      ))}
    </div>
  );
}

function SeriesCard({
  series,
  busy,
  run,
}: {
  series: ManagerSeries;
  busy: boolean;
  run: (label: string, fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(series.title);
  const [description, setDescription] = useState(series.description ?? "");
  const [addingTeaching, setAddingTeaching] = useState(false);
  const dirty = title !== series.title || description !== (series.description ?? "");
  const drafts = series.teachings.filter((t) => !t.isPublished).length;

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">{series.title}</CardTitle>
          <div className="flex items-center gap-2">
            {series.isPublished ? (
              <Badge variant="success">Published</Badge>
            ) : (
              <Badge variant="neutral">Draft</Badge>
            )}
            <Button
              size="sm"
              variant={series.isPublished ? "outline" : "default"}
              disabled={busy}
              onClick={() =>
                run(
                  series.isPublished ? "Unpublished" : "Published — members notified",
                  () => setSeriesPublished(series.id, !series.isPublished)
                )
              }
            >
              {series.isPublished ? "Unpublish" : "Publish"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-[var(--danger)]"
              aria-label={`Delete ${series.title}`}
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`Delete the "${series.title}" series and its teachings?`)) {
                  return;
                }
                void run("Series deleted", () => deleteSeries(series.id));
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
          />
        </div>
        {dirty && (
          <div>
            <Button
              size="sm"
              disabled={busy || !title.trim()}
              onClick={() =>
                run("Saved", () =>
                  updateSeries({ seriesId: series.id, title, description })
                )
              }
            >
              Save changes
            </Button>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {drafts > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-3 py-2">
            <p className="text-sm text-[var(--warning)]">
              {drafts} {drafts === 1 ? "teaching is" : "teachings are"} still a draft
              {series.isPublished
                ? " — members can't see them, even though the series is published."
                : ", and this series isn't published either."}
            </p>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => run("Published", () => publishAllTeachings(series.id))}
            >
              Publish {drafts === 1 ? "it" : "all"}
            </Button>
          </div>
        )}
        {series.teachings.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No teachings in this series yet.</p>
        ) : (
          <div className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
            {series.teachings.map((t) => (
              <TeachingRow key={t.id} teaching={t} busy={busy} run={run} />
            ))}
          </div>
        )}

        {addingTeaching ? (
          <AddTeachingForm
            seriesId={series.id}
            onDone={() => setAddingTeaching(false)}
            run={run}
            busy={busy}
          />
        ) : (
          <Button size="sm" variant="outline" onClick={() => setAddingTeaching(true)} disabled={busy}>
            <Plus className="h-4 w-4" /> Add a teaching
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function AddTeachingForm({
  seriesId,
  onDone,
  run,
  busy,
}: {
  seriesId: string;
  onDone: () => void;
  run: (label: string, fn: () => Promise<unknown>) => Promise<boolean>;
  busy: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [mediaType, setMediaType] = useState<TeachingMediaType>("audio");
  const [externalUrl, setExternalUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [stage, setStage] = useState("");

  const accept =
    mediaType === "video"
      ? ACCEPTED_TEACHING_VIDEO.join(",")
      : ACCEPTED_TEACHING_AUDIO.join(",");

  const ready =
    title.trim().length > 0 &&
    (mediaType === "link" ? externalUrl.trim().length > 0 : file !== null);

  /**
   * Links are a single server call. A file goes in three steps, because the
   * media is far too big for a server action body: ask the server for a signed
   * upload URL, upload straight to Supabase Storage from here, then tell the
   * server to record the row.
   */
  async function submit() {
    setUploading(true);
    try {
      if (mediaType === "link") {
        setStage("Saving…");
        const ok = await run("Teaching added", () =>
          finalizeTeaching({ seriesId, title, description, mediaType, externalUrl })
        );
        if (ok) onDone();
        return;
      }

      if (!file) return;

      setStage("Preparing upload…");
      const target = await prepareTeachingUpload({
        seriesId,
        filename: file.name,
        mediaType,
        sizeBytes: file.size,
      });

      setStage(`Uploading ${(file.size / (1024 * 1024)).toFixed(0)}MB…`);
      const supabase = createClient();
      const { error: uploadErr } = await supabase.storage
        .from("training")
        .uploadToSignedUrl(target.path, target.token, file, {
          contentType: file.type || (mediaType === "video" ? "video/mp4" : "audio/mpeg"),
        });
      if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

      setStage("Saving…");
      const ok = await run("Teaching added", () =>
        finalizeTeaching({
          seriesId,
          title,
          description,
          mediaType,
          storagePath: target.path,
        })
      );
      if (ok) onDone();
    } catch (e) {
      toast({
        title: "Couldn't add the teaching",
        description: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    } finally {
      setUploading(false);
      setStage("");
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
      <div className="space-y-2">
        <Label htmlFor="t-title">Title</Label>
        <Input
          id="t-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. The Essence of Media"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="t-desc">Description (optional)</Label>
        <Textarea
          id="t-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="t-type">Type</Label>
        <Select
          id="t-type"
          value={mediaType}
          onChange={(e) => setMediaType(e.target.value as TeachingMediaType)}
        >
          <option value="audio">Audio file (upload)</option>
          <option value="video">Video file (upload)</option>
          <option value="link">Link to somewhere else</option>
        </Select>
      </div>

      {mediaType === "link" ? (
        <div className="space-y-2">
          <Label htmlFor="t-url">Link</Label>
          <Input
            id="t-url"
            value={externalUrl}
            onChange={(e) => setExternalUrl(e.target.value)}
            placeholder="https://…"
          />
          <p className="text-xs text-[var(--text-muted)]">
            Playback can&apos;t be measured on someone else&apos;s site, so members can only
            self-mark a linked teaching. Upload the file if you want real listen tracking.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="t-file">{mediaType === "video" ? "Video" : "Audio"} file</Label>
          <Input
            id="t-file"
            type="file"
            accept={accept}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="text-xs text-[var(--text-muted)]">
            Up to {MAX_MB}MB. Accepted: {accept.replaceAll(",", ", ")}. The file uploads
            straight to storage, so a long teaching is fine — keep this tab open until it
            finishes.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <Button size="sm" disabled={busy || uploading || !ready} onClick={submit}>
          <Upload className="h-4 w-4" />
          {uploading ? stage || "Working…" : "Add teaching"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={uploading}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function TeachingRow({
  teaching,
  busy,
  run,
}: {
  teaching: ManagerTeaching;
  busy: boolean;
  run: (label: string, fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(teaching.title);
  const [description, setDescription] = useState(teaching.description ?? "");

  const Icon =
    teaching.mediaType === "video"
      ? Video
      : teaching.mediaType === "link"
      ? ExternalLink
      : Headphones;

  if (editing) {
    return (
      <div className="space-y-2 bg-[var(--bg)] px-4 py-3">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={busy || !title.trim()}
            onClick={async () => {
              const ok = await run("Saved", () =>
                updateTeaching({ teachingId: teaching.id, title, description })
              );
              if (ok) setEditing(false);
            }}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setTitle(teaching.title);
              setDescription(teaching.description ?? "");
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Icon className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {teaching.position}. {teaching.title}
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          {formatDuration(teaching.durationSeconds)}
          {teaching.durationSeconds === null && " · set once someone plays it"}
        </p>
      </div>
      {teaching.isPublished ? (
        <Badge variant="success">Published</Badge>
      ) : (
        <Badge variant="neutral">Draft</Badge>
      )}
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Rename ${teaching.title}`}
        disabled={busy}
        onClick={() => setEditing(true)}
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() =>
          run(teaching.isPublished ? "Unpublished" : "Published", () =>
            setTeachingPublished(teaching.id, !teaching.isPublished)
          )
        }
      >
        {teaching.isPublished ? "Unpublish" : "Publish"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-[var(--danger)]"
        aria-label={`Delete ${teaching.title}`}
        disabled={busy}
        onClick={() => {
          if (!window.confirm(`Delete "${teaching.title}"?`)) return;
          void run("Teaching deleted", () => deleteTeaching(teaching.id));
        }}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
