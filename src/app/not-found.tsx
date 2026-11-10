import Link from "next/link";

/** The site-wide fallback for an address that matches nothing. */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <h1 className="text-xl font-semibold">That page isn&apos;t here</h1>
        <p className="text-sm text-[var(--text-muted)]">
          The address may be mistyped, or the page may have been moved.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-foreground)]"
        >
          Go to the dashboard
        </Link>
      </div>
    </main>
  );
}
