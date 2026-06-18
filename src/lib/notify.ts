import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Inserts an in-app notification (Section 13). Uses the admin client because
 * notifications are created *for other users* by the system, and the RLS
 * insert policy is restricted. Best-effort: never throws into the caller.
 */
export async function notify(input: {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
}) {
  try {
    const admin = createAdminClient();
    await admin.from("notifications").insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    });
  } catch {
    // Notifications are non-critical; swallow errors.
  }
}
