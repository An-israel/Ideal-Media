"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  ArrowDown,
  Pencil,
  Trash2,
  Plus,
  AlertTriangle,
  GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { MIN_MODULES_GUIDANCE } from "@/lib/constants";
import type { ContentType } from "@/lib/database.types";
import {
  addModule,
  deleteModule,
  moveModule,
  setPublished,
  updateCourse,
  updateModule,
} from "../actions";

export type EditorModule = {
  id: string;
  position: number;
  title: string;
  content_type: ContentType;
  content_url: string;
  content_body: string;
  instructions: string;
};

const CONTENT_TYPES: ContentType[] = ["article", "youtube", "video", "file", "link", "other"];

type ModuleDraft = Omit<EditorModule, "id" | "position">;
const emptyDraft: ModuleDraft = {
  title: "",
  content_type: "article",
  content_url: "",
  content_body: "",
  instructions: "",
};

export function CourseEditor({
  courseId,
  initialTitle,
  initialDescription,
  isPublished,
  modules,
}: {
  courseId: string;
  initialTitle: string;
  initialDescription: string;
  isPublished: boolean;
  modules: EditorModule[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [savingDetails, setSavingDetails] = useState(false);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState<EditorModule | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<ModuleDraft>(emptyDraft);

  async function saveDetails() {
    setSavingDetails(true);
    try {
      await updateCourse({ courseId, title, description });
      toast({ title: "Course details saved", variant: "success" });
    } catch (e) {
      toast({ title: "Save failed", description: String(e), variant: "error" });
    } finally {
      setSavingDetails(false);
    }
  }

  async function togglePublish() {
    setBusy(true);
    try {
      await setPublished(courseId, !isPublished);
      router.refresh();
    } catch (e) {
      toast({ title: "Could not update", description: String(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function submitAdd() {
    if (!draft.title.trim()) return;
    setBusy(true);
    try {
      await addModule({ courseId, ...draft, contentType: draft.content_type, contentUrl: draft.content_url, contentBody: draft.content_body });
      setAdding(false);
      setDraft(emptyDraft);
      router.refresh();
    } catch (e) {
      toast({ title: "Could not add module", description: String(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit() {
    if (!editing) return;
    setBusy(true);
    try {
      await updateModule({
        moduleId: editing.id,
        courseId,
        title: editing.title,
        contentType: editing.content_type,
        contentUrl: editing.content_url,
        contentBody: editing.content_body,
        instructions: editing.instructions,
      });
      setEditing(null);
      router.refresh();
    } catch (e) {
      toast({ title: "Could not save module", description: String(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await deleteModule(id, courseId);
      router.refresh();
    } catch (e) {
      toast({ title: "Could not delete", description: String(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function move(id: string, direction: "up" | "down") {
    setBusy(true);
    try {
      await moveModule(id, courseId, direction);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title || "Untitled course"}</h1>
          <div className="mt-1.5">
            {isPublished ? (
              <Badge variant="success">Published</Badge>
            ) : (
              <Badge variant="neutral">Draft</Badge>
            )}
          </div>
        </div>
        <Button variant={isPublished ? "outline" : "default"} onClick={togglePublish} disabled={busy}>
          {isPublished ? "Unpublish" : "Publish"}
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label htmlFor="ct">Title</Label>
            <Input id="ct" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cd">Description</Label>
            <Textarea id="cd" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <Button onClick={saveDetails} disabled={savingDetails} variant="secondary">
            {savingDetails ? "Saving…" : "Save details"}
          </Button>
        </CardContent>
      </Card>

      {modules.length < MIN_MODULES_GUIDANCE && (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-3 text-sm text-[var(--warning)]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Aim for at least {MIN_MODULES_GUIDANCE} modules per course (currently {modules.length}).
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Modules</h2>
        <Button onClick={() => { setDraft(emptyDraft); setAdding(true); }}>
          <Plus className="h-4 w-4" />
          Add module
        </Button>
      </div>

      <div className="space-y-2">
        {modules.map((m, i) => (
          <Card key={m.id}>
            <CardContent className="flex items-center gap-3 py-3">
              <GripVertical className="h-4 w-4 text-[var(--text-muted)]" />
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--bg)] text-xs font-medium">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.title}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {m.content_type}
                  {m.instructions ? " · has assignment" : " · no assignment"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" disabled={i === 0 || busy} onClick={() => move(m.id, "up")}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" disabled={i === modules.length - 1 || busy} onClick={() => move(m.id, "down")}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setEditing(m)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" disabled={busy} onClick={() => remove(m.id)}>
                  <Trash2 className="h-4 w-4 text-[var(--danger)]" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {modules.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-[var(--text-muted)]">
              No modules yet.
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add module dialog */}
      <Dialog open={adding} onClose={() => setAdding(false)} title="Add module">
        <ModuleFields
          value={draft}
          onChange={setDraft}
          onSubmit={submitAdd}
          submitLabel="Add module"
          busy={busy}
        />
      </Dialog>

      {/* Edit module dialog */}
      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Edit module">
        {editing && (
          <ModuleFields
            value={editing}
            onChange={(v) => setEditing({ ...editing, ...v })}
            onSubmit={submitEdit}
            submitLabel="Save module"
            busy={busy}
          />
        )}
      </Dialog>
    </div>
  );
}

function ModuleFields({
  value,
  onChange,
  onSubmit,
  submitLabel,
  busy,
}: {
  value: ModuleDraft;
  onChange: (v: ModuleDraft) => void;
  onSubmit: () => void;
  submitLabel: string;
  busy: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Title</Label>
        <Input value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Content type</Label>
          <Select
            value={value.content_type}
            onChange={(e) => onChange({ ...value, content_type: e.target.value as ContentType })}
          >
            {CONTENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Content URL</Label>
          <Input
            value={value.content_url}
            onChange={(e) => onChange({ ...value, content_url: e.target.value })}
            placeholder="https://…"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Inline content (optional)</Label>
        <Textarea
          value={value.content_body}
          onChange={(e) => onChange({ ...value, content_body: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label>Assignment instructions</Label>
        <Textarea
          value={value.instructions}
          onChange={(e) => onChange({ ...value, instructions: e.target.value })}
        />
      </div>
      <Button onClick={onSubmit} disabled={busy || !value.title.trim()} className="w-full">
        {busy ? "Saving…" : submitLabel}
      </Button>
    </div>
  );
}
