"use client";

import { useEffect, useState } from "react";
import { Sparkles, X, ChevronDown, PartyPopper } from "lucide-react";
import type { Role } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "im-guide-dismissed";

type Section = { id: string; emoji: string; title: string; steps: string[] };

function sectionsFor(roles: Role[]): Section[] {
  const has = (r: Role) => roles.includes(r);
  const sections: Section[] = [
    {
      id: "basics",
      emoji: "🎬",
      title: "The basics (everyone)",
      steps: [
        "Your **Dashboard** shows your subunits and a performance ring — it fills in as you complete courses and show up to service.",
        "Open **My Courses** to learn. Work through a course one module at a time.",
        "A module unlocks only after your leader approves the one before it — so go in order. 🔓",
        "When you finish a module's task, tap **Submit to leader on WhatsApp**. Your work travels over WhatsApp; your leader approves it back here.",
        "The 🔔 bell at the top tells you when something's approved or needs a redo.",
      ],
    },
  ];

  if (has("subunit_leader") || has("super_admin")) {
    sections.push({
      id: "leader",
      emoji: "🧑‍🏫",
      title: "Leading a subunit",
      steps: [
        "**Build a course:** Leader → **Courses** → **New course** (top-right). Add 7–10 modules; each gets content (article, YouTube, file…) and one assignment.",
        "Hit **Publish** when it's ready — members in your subunit get enrolled automatically. 🎉",
        "**Approvals:** Leader → **Approvals** is your inbox — approve or send back assignment submissions, and accept course applications.",
        "**Members:** Leader → **Members** shows each person's progress, attendance, and performance.",
      ],
    });
  }

  if (has("secretary") || has("super_admin")) {
    sections.push({
      id: "secretary",
      emoji: "🗂️",
      title: "Secretary duties",
      steps: [
        "**Upload attendance:** Secretary → **Attendance** → pick the activity and date, drop in the sheet (.xlsx or .csv).",
        "The AI matches names to your roster. You **review** it — fix any low-confidence guesses — then **Commit**. Nothing is saved until you commit. ✅",
        "**Roster:** set member statuses. Mark someone **traveled** and they won't be flagged for missing service.",
      ],
    });
  }

  if (has("welfare") || has("super_admin")) {
    sections.push({
      id: "welfare",
      emoji: "💛",
      title: "Welfare follow-ups",
      steps: [
        "The **Welfare** board fills itself — new members and anyone missing service show up automatically. No hunting required.",
        "On each card: set the **level** (1→3), update **status**, jot **notes**, **assign** a teammate, or message them on **WhatsApp**.",
        "Tap **Resolve** when you've closed the loop and it leaves the board.",
      ],
    });
  }

  if (has("super_admin")) {
    sections.push({
      id: "admin",
      emoji: "👑",
      title: "Director (admin)",
      steps: [
        "**Admin → Roles** is where you promote people: subunit leaders, the secretary, and welfare team.",
        "**Subunits, Activities, Code of Conduct** are all editable — including the missed-service threshold and the quiz questions.",
        "**Overview** gives you charts and totals across the whole department.",
      ],
    });
  }

  return sections;
}

/** Renders simple **bold** markup as <strong>. */
function renderStep(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} className="font-semibold text-[var(--text)]">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

export function Guide({ roles }: { roles: Role[] }) {
  const [open, setOpen] = useState(false);
  const [openSection, setOpenSection] = useState<string>("basics");
  const sections = sectionsFor(roles);

  useEffect(() => {
    // Auto-open once, the very first time (intentional one-shot on mount).
    if (!localStorage.getItem(STORAGE_KEY)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
    }
  }, []);

  function dismiss() {
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
  }

  return (
    <>
      {/* Floating launcher */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium shadow-lg transition-transform hover:scale-105"
        aria-label="Open the guide"
      >
        <Sparkles className="h-4 w-4 text-[var(--accent)]" />
        Guide
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-5">
              <div className="flex items-center gap-2">
                <PartyPopper className="h-5 w-5 text-[var(--accent)]" />
                <div>
                  <h2 className="text-base font-semibold">Welcome to Ideal Media 👋</h2>
                  <p className="text-xs text-[var(--text-muted)]">
                    A quick tour of what you can do. Tap a section to expand.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text)]"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {sections.map((s) => {
                const expanded = openSection === s.id;
                return (
                  <div key={s.id} className="rounded-xl border border-[var(--border)]">
                    <button
                      onClick={() => setOpenSection(expanded ? "" : s.id)}
                      className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium"
                    >
                      <span>
                        <span className="mr-2">{s.emoji}</span>
                        {s.title}
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform",
                          expanded && "rotate-180"
                        )}
                      />
                    </button>
                    {expanded && (
                      <ol className="space-y-2.5 px-4 pb-4">
                        {s.steps.map((step, i) => (
                          <li key={i} className="flex gap-2.5 text-sm text-[var(--text-muted)]">
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[11px] font-semibold text-[var(--accent)]">
                              {i + 1}
                            </span>
                            <span className="leading-relaxed">{renderStep(step)}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="border-t border-[var(--border)] p-4">
              <Button className="w-full" onClick={dismiss}>
                Got it — let&apos;s go!
              </Button>
              <p className="mt-2 text-center text-xs text-[var(--text-muted)]">
                You can reopen this anytime with the ✨ Guide button.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
