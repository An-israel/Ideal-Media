import "server-only";

/**
 * Sending email, through Resend's HTTP API.
 *
 * In-app notifications only reach somebody who opens the app, and the person
 * who most needs an attendance reminder is the leader who has not opened it.
 * Email is the channel that gets to them anyway.
 *
 * It is strictly optional. With RESEND_API_KEY or EMAIL_FROM unset this sends
 * nothing and says so, and every caller treats email as an extra on top of the
 * notification it has already written — so a missing key, a bad address or an
 * outage at the provider can never stop the thing the email was about.
 *
 * No SDK: one POST per message is all it needs, and a dependency that can
 * break the build is a poor trade for saving twenty lines.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text. Kept plain so it reads the same in every mail client. */
  text: string;
}

export interface EmailResult {
  configured: boolean;
  sent: number;
  failed: number;
  /** Why nothing was sent, or the first failure. */
  note?: string;
}

/** Placeholder addresses given to members added without a real email. */
const PLACEHOLDER_DOMAIN = "@no-email.ideal-media.app";

/** True for an address worth sending to. */
export function isDeliverable(email: string | null | undefined): email is string {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !e.endsWith(PLACEHOLDER_DOMAIN);
}

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

export async function sendEmails(messages: EmailMessage[]): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) {
    return {
      configured: false,
      sent: 0,
      failed: 0,
      note: "Email is not set up (RESEND_API_KEY and EMAIL_FROM).",
    };
  }

  const deliverable = messages.filter((m) => isDeliverable(m.to));
  let sent = 0;
  let failed = 0;
  let note: string | undefined;

  // A few at a time: the free tier allows only a couple of requests a second,
  // and a burst of sixty would mostly come back as rate-limited.
  for (let i = 0; i < deliverable.length; i += 2) {
    const batch = deliverable.slice(i, i + 2);
    const results = await Promise.all(
      batch.map(async (m) => {
        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from, to: [m.to.trim()], subject: m.subject, text: m.text }),
          });
          if (res.ok) return null;
          return `${res.status} ${(await res.text()).slice(0, 200)}`;
        } catch (e) {
          return e instanceof Error ? e.message : "network error";
        }
      })
    );
    for (const r of results) {
      if (r === null) sent += 1;
      else {
        failed += 1;
        note ??= r;
      }
    }
    if (i + 2 < deliverable.length) await new Promise((r) => setTimeout(r, 1100));
  }

  if (failed > 0) console.error(`[email] ${failed} of ${deliverable.length} failed:`, note);
  return { configured: true, sent, failed, note };
}
