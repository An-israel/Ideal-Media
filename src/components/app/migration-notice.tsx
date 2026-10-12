import { Database } from "lucide-react";
import type { MigrationNeed } from "@/lib/schema-check";

/**
 * Says which SQL file to run, instead of letting the page die with a generic
 * "Application error" that looks exactly like a deployment that never landed.
 */
export function MigrationNotice({ needs }: { needs: MigrationNeed[] }) {
  if (needs.length === 0) return null;
  return (
    <div className="space-y-3 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-[var(--warning)]">
        <Database className="h-4 w-4" />
        This page needs a database update first
      </p>
      <p className="text-sm text-[var(--text-muted)]">
        The code is deployed, but {needs.length === 1 ? "a migration has" : "migrations have"} not
        been run yet. In Supabase, open <strong>SQL Editor → New query</strong>, paste the contents
        of {needs.length === 1 ? "this file" : "these files"} from the project and click{" "}
        <strong>Run</strong>. {needs.length === 1 ? "It is" : "They are"} safe to run twice.
      </p>
      <ul className="space-y-1">
        {needs.map((n) => (
          <li key={n.file} className="text-sm">
            <code className="rounded bg-[var(--bg)] px-1.5 py-0.5">
              supabase/migrations/{n.file}
            </code>{" "}
            <span className="text-[var(--text-muted)]">— {n.feature}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-[var(--text-muted)]">
        Run them in file-number order, then reload this page.
      </p>
    </div>
  );
}
