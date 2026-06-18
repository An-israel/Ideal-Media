"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { shuffle } from "@/lib/utils";
import { getQuizQuestions, gradeQuiz, type QuizQuestion } from "./actions";
import { cn } from "@/lib/utils";

type Stage = "read" | "quiz" | "failed";

// Display copy of a question with options shuffled, each carrying its original
// index so grading on the server stays correct (Section 6).
type DisplayQuestion = {
  id: string;
  question: string;
  options: { text: string; originalIndex: number }[];
};

function prepare(questions: QuizQuestion[]): DisplayQuestion[] {
  return questions.map((q) => ({
    id: q.id,
    question: q.question,
    options: shuffle(q.options.map((text, originalIndex) => ({ text, originalIndex }))),
  }));
}

export function CocFlow({ title, body }: { title: string; body: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("read");
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [questions, setQuestions] = useState<DisplayQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
      setScrolledToEnd(true);
    }
  }

  async function startQuiz() {
    setLoading(true);
    const q = await getQuizQuestions();
    setQuestions(prepare(q));
    setAnswers({});
    setStage("quiz");
    setLoading(false);
  }

  async function submitQuiz() {
    setLoading(true);
    const payload = questions.map((q) => ({
      questionId: q.id,
      selectedIndex: answers[q.id],
    }));
    const result = await gradeQuiz(payload);
    setLoading(false);
    if (result.passed) {
      router.push("/dashboard");
      router.refresh();
    } else {
      setStage("failed");
    }
  }

  const allAnswered = questions.length > 0 && questions.every((q) => answers[q.id] !== undefined);

  if (stage === "failed") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Please read the code of conduct again</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-[var(--text-muted)]">
            Not all of your answers were correct. Take another careful read and
            try the quiz again.
          </p>
          <Button
            onClick={() => {
              setScrolledToEnd(false);
              setStage("read");
            }}
          >
            Read again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (stage === "quiz") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Quick check</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {questions.map((q, qi) => (
            <div key={q.id} className="space-y-3">
              <p className="text-sm font-medium">
                {qi + 1}. {q.question}
              </p>
              <div className="grid gap-2">
                {q.options.map((opt) => {
                  const selected = answers[q.id] === opt.originalIndex;
                  return (
                    <button
                      key={opt.originalIndex}
                      type="button"
                      onClick={() =>
                        setAnswers((a) => ({ ...a, [q.id]: opt.originalIndex }))
                      }
                      className={cn(
                        "rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors",
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent)]/8"
                          : "border-[var(--border)] hover:bg-[var(--bg)]"
                      )}
                    >
                      {opt.text}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <Button onClick={submitQuiz} disabled={!allAnswered || loading} className="w-full">
            {loading ? "Checking…" : "Submit answers"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="max-h-[55vh] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5"
        >
          <Markdown content={body} />
        </div>
        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          {scrolledToEnd ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
              You&apos;ve read to the end.
            </>
          ) : (
            "Scroll to the bottom to continue."
          )}
        </div>
        <Button
          disabled={!scrolledToEnd || loading}
          onClick={startQuiz}
          className="w-full"
        >
          {loading ? "Loading…" : "I have read and agree"}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Minimal markdown rendering (headings, lists, paragraphs) — no dependency. */
function Markdown({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith("# "))
          return <h1 key={i} className="text-xl font-semibold">{line.slice(2)}</h1>;
        if (line.startsWith("## "))
          return <h2 key={i} className="mt-3 text-base font-semibold">{line.slice(3)}</h2>;
        if (line.trim() === "") return <div key={i} className="h-1" />;
        return <p key={i} className="text-[var(--text)]">{line}</p>;
      })}
    </div>
  );
}
