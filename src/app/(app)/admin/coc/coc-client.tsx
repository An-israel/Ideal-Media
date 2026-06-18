"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import { publishCocVersion, createQuestion, toggleQuestion, deleteQuestion } from "../actions";

export type QuestionRow = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  isActive: boolean;
};

export function CocClient({
  title: initialTitle,
  body: initialBody,
  version,
  questions,
}: {
  title: string;
  body: string;
  version: number;
  questions: QuestionRow[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [busy, setBusy] = useState(false);

  // New question form
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState("");
  const [correct, setCorrect] = useState(0);

  async function publish() {
    setBusy(true);
    try {
      await publishCocVersion(title, body);
      toast({ title: "Published new version", variant: "success" });
      router.refresh();
    } catch (e) {
      toast({ title: "Publish failed", description: String(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function addQuestion() {
    const options = opts.split("\n").map((o) => o.trim()).filter(Boolean);
    if (!q.trim() || options.length < 2) {
      toast({ title: "Add a question and at least 2 options", variant: "error" });
      return;
    }
    setBusy(true);
    try {
      await createQuestion(q, options, Math.min(correct, options.length - 1));
      setQ("");
      setOpts("");
      setCorrect(0);
      router.refresh();
    } catch (e) {
      toast({ title: "Could not add", description: String(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active code of conduct (v{version})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Body (markdown)</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-64 font-mono text-xs" />
          </div>
          <Button onClick={publish} disabled={busy}>
            Publish as new version
          </Button>
          <p className="text-xs text-[var(--text-muted)]">
            Publishing creates v{version + 1} and deactivates the current version.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Question bank ({questions.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {questions.map((qq) => (
            <div
              key={qq.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border)] px-3.5 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{qq.question}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {qq.options.map((o, i) => (
                    <span key={i} className={i === qq.correctIndex ? "text-[var(--success)]" : ""}>
                      {o}
                      {i < qq.options.length - 1 ? " · " : ""}
                    </span>
                  ))}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => toggleQuestion(qq.id, !qq.isActive).then(() => router.refresh())}
                  className="text-xs"
                >
                  <Badge variant={qq.isActive ? "success" : "neutral"}>
                    {qq.isActive ? "active" : "disabled"}
                  </Badge>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => deleteQuestion(qq.id).then(() => router.refresh())}
                >
                  <Trash2 className="h-4 w-4 text-[var(--danger)]" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add question</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>Question</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Options (one per line)</Label>
            <Textarea value={opts} onChange={(e) => setOpts(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Correct option index (0-based)</Label>
            <Input
              type="number"
              min={0}
              value={correct}
              onChange={(e) => setCorrect(Number(e.target.value))}
              className="w-24"
            />
          </div>
          <Button onClick={addQuestion} disabled={busy}>
            <Plus className="h-4 w-4" /> Add question
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
