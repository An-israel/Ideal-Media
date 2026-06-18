"use client";

import { useEffect, useState } from "react";
import { Sparkles, X, ChevronDown } from "lucide-react";
import type { Role } from "@/lib/constants";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "im-guide-dismissed";

type Section = { id: string; emoji: string; title: string; steps: string[] };

function sectionsFor(roles: Role[]): Section[] {
  const has = (r: Role) => roles.includes(r);
  const sections: Section[] = [
    {
      id: "basics",
      emoji: "🎬",
      title: "The basics",
      steps: [
        "**Dashboard** — your subunits and a performance ring that grows as you do courses and attend service.",
        "**My Courses** — learn one module at a time; they unlock in order. 🔓",
        "Finished a task? Tap **Submit to leader on WhatsApp** — your leader approves it back here.",
        "The 🔔 bell shows approvals and redo requests.",
      ],
    },
  ];
  if (has("subunit_leader") || has("super_admin"))
    sections.push({
      id: "leader",
      emoji: "🧑‍🏫",
      title: "Leading",
      steps: [
        "**Build:** Leader → Courses → New course → add modules (content + 1 assignment) → **Publish**.",
        "**Approvals** — review submissions and course applications.",
        "**Members** — each person's progress, attendance, performance.",
      ],
    });
  if (has("secretary") || has("super_admin"))
    sections.push({
      id: "secretary",
      emoji: "🗂️",
      title: "Secretary",
      steps: [
        "**Attendance** — pick activity + date, upload a sheet **or snap a photo** 📸. AI maps names → review → **Commit**.",
        "**Roster** — set member status. “Traveled” skips missed-service flags.",
      ],
    });
  if (has("welfare") || has("super_admin"))
    sections.push({
      id: "welfare",
      emoji: "💛",
      title: "Welfare",
      steps: [
        "The board fills itself — new members + anyone missing service.",
        "Per card: set level, status, notes, assign, WhatsApp, then **Resolve**.",
      ],
    });
  if (has("super_admin"))
    sections.push({
      id: "admin",
      emoji: "👑",
      title: "Admin",
      steps: [
        "**Roles** — promote leaders, secretary, welfare.",
        "**Subunits, Activities, Code of Conduct, Overview** all live here.",
      ],
    });
  return sections;
}

function renderStep(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
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
  const [openSection, setOpenSection] = useState<string>("");
  const sections = sectionsFor(roles);

  useEffect(() => {
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
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-sm font-medium shadow-lg transition-transform hover:scale-105"
        aria-label="Open the guide"
      >
        <Sparkles className="h-4 w-4 text-[var(--accent)]" />
        Guide
      </button>

      {open && (
        <div
          className="fixed bottom-20 right-5 z-50 flex max-h-[65vh] w-80 max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl"
          role="dialog"
          aria-label="Quick guide"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[var(--accent)]" />
              <span className="text-sm font-semibold">Quick guide</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-[var(--text-muted)] hover:text-[var(--text)]"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {sections.map((s) => {
              const expanded = openSection === s.id;
              return (
                <div key={s.id}>
                  <button
                    onClick={() => setOpenSection(expanded ? "" : s.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium hover:bg-[var(--bg)]"
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
                    <ul className="space-y-2 px-2.5 pb-3 pt-1">
                      {s.steps.map((step, i) => (
                        <li
                          key={i}
                          className="flex gap-2 text-[13px] leading-snug text-[var(--text-muted)]"
                        >
                          <span className="mt-px text-[var(--accent)]">•</span>
                          <span>{renderStep(step)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          <button
            onClick={dismiss}
            className="border-t border-[var(--border)] px-4 py-2.5 text-sm font-medium text-[var(--accent)] hover:bg-[var(--bg)]"
          >
            Got it
          </button>
        </div>
      )}
    </>
  );
}
