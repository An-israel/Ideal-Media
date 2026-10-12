import { SignOutOnLoad } from "./sign-out-on-load";

/**
 * Shown to someone whose access has been revoked.
 *
 * Sits outside the (app) layout on purpose: that layout is what redirects here,
 * so rendering inside it would loop. The session is cleared on arrival so a
 * stale cookie cannot carry them back in, and the message says who to talk to
 * rather than leaving them staring at a login screen that keeps rejecting them.
 */
export default function AccessRemovedPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <h1 className="text-xl font-semibold">Your access has been removed</h1>
        <p className="text-sm text-[var(--text-muted)]">
          This account is no longer active on the Ideal Media platform. Your records have been
          kept — nothing has been deleted.
        </p>
        <p className="text-sm text-[var(--text-muted)]">
          If you believe this is a mistake, please speak to the media secretary or the welfare
          team and they can restore it.
        </p>
        <SignOutOnLoad />
      </div>
    </main>
  );
}
