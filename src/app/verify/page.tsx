import Link from "next/link";
import { BadgeCheck, SearchX } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { Wordmark } from "@/components/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata = { title: "Check a certificate — Ideal Media" };

/**
 * Checking a Skills Academy certificate.
 *
 * Open to anyone, signed in or not: the point of the number printed on a
 * certificate is that the person it is shown to can confirm it without having
 * an account. It answers one question — is this number real, and whose is it —
 * and gives away nothing else: no list, no search by name, and the same answer
 * for a mistyped code as for one that never existed.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code: raw } = await searchParams;
  const code = normalizeCode(raw ?? "");
  const result = code ? await lookup(code) : null;

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--bg)]">
      <header className="flex items-center justify-between border-b border-[var(--border)] p-6">
        <Wordmark />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-6">
          <div>
            <h1 className="text-xl font-semibold">Check a certificate</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Enter the number printed at the bottom of an Ideal Life City Media Skills Academy
              certificate.
            </p>
          </div>

          <form method="get" className="flex gap-2">
            <input
              name="code"
              defaultValue={raw ?? ""}
              placeholder="ILC-XXXX-XXXX"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="h-10 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 font-mono text-sm uppercase outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
            <button
              type="submit"
              className="h-10 rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-foreground)]"
            >
              Check
            </button>
          </form>

          {raw && result && (
            <div className="rounded-2xl border border-[var(--success)]/40 bg-[var(--surface)] p-6">
              <p className="flex items-center gap-2 text-sm font-medium text-[var(--success)]">
                <BadgeCheck className="h-4 w-4" /> This certificate is genuine
              </p>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-xs text-[var(--text-muted)]">Awarded to</dt>
                  <dd className="text-base font-semibold">{result.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--text-muted)]">For completing</dt>
                  <dd>{result.course}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--text-muted)]">Issued</dt>
                  <dd>{result.issued}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--text-muted)]">Certificate number</dt>
                  <dd className="font-mono">{result.code}</dd>
                </div>
              </dl>
            </div>
          )}

          {raw && !result && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
              <p className="flex items-center gap-2 text-sm font-medium">
                <SearchX className="h-4 w-4 text-[var(--text-muted)]" /> No certificate has that
                number
              </p>
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                Check it against the printed certificate — the number looks like{" "}
                <span className="font-mono">ILC-AB12-CD34</span> and never contains the letters O
                or I, or the digits 0 or 1.
              </p>
            </div>
          )}

          <p className="text-center text-xs text-[var(--text-muted)]">
            <Link href="/login" className="hover:underline">
              Member sign in
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

/** Uppercases and re-dashes whatever was typed: "ilc ab12cd34" → "ILC-AB12-CD34". */
function normalizeCode(raw: string): string | null {
  const letters = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^ILC[A-Z0-9]{8}$/.test(letters)) return null;
  return `ILC-${letters.slice(3, 7)}-${letters.slice(7, 11)}`;
}

async function lookup(code: string) {
  try {
    const admin = createAdminClient();
    const { data: cert } = await admin
      .from("academy_certificates")
      .select("code, issued_at, user_id, course_id")
      .eq("code", code)
      .maybeSingle();
    if (!cert) return null;

    const [{ data: profile }, { data: course }] = await Promise.all([
      admin.from("profiles").select("full_name").eq("id", cert.user_id).maybeSingle(),
      admin.from("academy_courses").select("title").eq("id", cert.course_id).maybeSingle(),
    ]);
    if (!profile || !course) return null;

    return {
      code: cert.code,
      name: profile.full_name,
      course: course.title,
      issued: new Date(cert.issued_at).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    };
  } catch {
    // A database problem reads as "not found" rather than an error page: this
    // is a public address and should never show a stack trace to a stranger.
    return null;
  }
}
