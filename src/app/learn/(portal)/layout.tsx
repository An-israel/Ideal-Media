import Link from "next/link";
import { redirect } from "next/navigation";
import { GraduationCap, UserRound, LogOut } from "lucide-react";
import { getAcademyUserState } from "@/lib/academy-user";
import { signOut } from "@/app/(app)/actions";
import { Wordmark } from "@/components/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The course-only learners' area.
 *
 * A separate shell from the department's app, not the same one with items
 * hidden: there is no dashboard, roster, attendance or subunits here to hide,
 * because a learner is not part of the department. The academy pages inside
 * it are the very same components the department uses.
 */
export default async function LearnLayout({ children }: { children: React.ReactNode }) {
  const state = await getAcademyUserState();

  if (state.status === "signed-out" || state.status === "unknown") redirect("/login");
  // A department member has the academy inside their own app.
  if (state.status === "member-blocked") redirect("/dashboard");
  if (state.status === "ok" && state.user.kind === "member") redirect("/academy");

  if (state.status === "learner-suspended") {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
          <h1 className="text-xl font-semibold">Your access to the courses is paused</h1>
          <p className="text-sm text-[var(--text-muted)]">
            {state.reason ?? "An administrator has paused this account."} Your progress has been
            kept. If you think this is a mistake, contact the Ideal Life City media team.
          </p>
          <form action={signOut}>
            <button className="text-sm text-[var(--accent)] hover:underline">Sign out</button>
          </form>
        </div>
      </main>
    );
  }

  const name = state.status === "ok" ? state.user.fullName : "";

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--bg)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link href="/learn" aria-label="Skills Academy home">
            <Wordmark />
          </Link>
          <span className="hidden rounded-full bg-[var(--accent)]/10 px-2.5 py-0.5 text-xs font-medium text-[var(--accent)] sm:inline">
            Skills Academy
          </span>
          <nav className="ml-auto flex items-center gap-1">
            <Link
              href="/learn"
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              <GraduationCap className="h-4 w-4" />
              <span className="hidden sm:inline">Courses</span>
            </Link>
            <Link
              href="/learn/account"
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
              title={name}
            >
              <UserRound className="h-4 w-4" />
              <span className="hidden sm:inline">My account</span>
            </Link>
            <ThemeToggle />
            <form action={signOut}>
              <button
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
