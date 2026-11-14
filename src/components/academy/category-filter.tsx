"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Category chips. Links rather than client-side state, so a chosen category
 * survives opening a course and pressing back, and can be shared.
 */
export function CategoryFilter({
  basePath = "/academy",
  categories,
  active,
}: {
  basePath?: string;
  categories: string[];
  active: string | null;
}) {
  const chip = (label: string, href: string, on: boolean) => (
    <Link
      key={label}
      href={href}
      scroll={false}
      className={cn(
        "whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors",
        on
          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
          : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
      )}
    >
      {label}
    </Link>
  );

  return (
    <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
      {chip("All", basePath, active === null)}
      {categories.map((c) =>
        chip(c, `${basePath}?category=${encodeURIComponent(c)}`, active === c)
      )}
    </div>
  );
}
