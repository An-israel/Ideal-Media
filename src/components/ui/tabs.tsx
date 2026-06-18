"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Minimal tab strip. Pass tabs + the active value; parent owns state. */
export function Tabs({
  tabs,
  value,
  onValueChange,
  className,
}: {
  tabs: { value: string; label: string; count?: number }[];
  value: string;
  onValueChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-1 border-b border-[var(--border)]", className)}>
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            onClick={() => onValueChange(t.value)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-[var(--accent)] text-[var(--text)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
            )}
          >
            {t.label}
            {typeof t.count === "number" && t.count > 0 && (
              <span className="ml-1.5 rounded-full bg-[var(--accent)]/10 px-1.5 py-0.5 text-xs text-[var(--accent)]">
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
