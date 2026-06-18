"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";

// Top-level pages reached from the sidebar — no back button needed.
const TOP_LEVEL = new Set([
  "/dashboard",
  "/leader",
  "/secretary",
  "/welfare",
  "/admin",
  "/courses",
  "/notifications",
]);

/**
 * Shows a "Back" link to the parent section on any nested page (e.g.
 * /leader/courses/123 → /leader/courses). Hidden on top-level pages.
 */
export function BackButton() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length <= 1 || TOP_LEVEL.has(pathname)) return null;

  const parent = "/" + segments.slice(0, -1).join("/");

  return (
    <Link
      href={parent}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--border)]/40 hover:text-[var(--text)]"
    >
      <ArrowLeft className="h-4 w-4" />
      Back
    </Link>
  );
}
