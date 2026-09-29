import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { chunk } from "@/lib/pagination";
import { PAGE_SIZE } from "@/lib/constants";

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
}

function toRow(input: NotifyInput) {
  return {
    user_id: input.userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
  };
}

/**
 * Inserts in-app notifications (Section 13). Uses the admin client because
 * notifications are created *for other users* by the system, and the RLS
 * insert policy is restricted.
 *
 * Best-effort — a failure never breaks the caller's actual work — but it is
 * LOGGED (AUDIT NOTIF-3). The old bare `catch {}` meant you could not tell
 * "nothing to notify" from "notifications have been broken for three weeks",
 * and notifications are the primary signal for leaders and welfare.
 */
export async function notifyMany(inputs: NotifyInput[]): Promise<void> {
  if (inputs.length === 0) return;
  try {
    // One client and one insert per batch rather than a client per recipient
    // (AUDIT NOTIF-4): a bulk status change across 50 members × 5 welfare staff
    // was 250 clients and 250 round trips inside a single server action.
    const admin = createAdminClient();
    for (const batch of chunk(inputs.map(toRow), PAGE_SIZE)) {
      const { error } = await admin.from("notifications").insert(batch);
      if (error) {
        console.error(
          `[notify] failed to insert ${batch.length} notification(s):`,
          error.message
        );
      }
    }
  } catch (e) {
    console.error("[notify] unexpected failure:", e);
  }
}

/** Single-recipient convenience wrapper around notifyMany. */
export async function notify(input: NotifyInput): Promise<void> {
  await notifyMany([input]);
}

/**
 * Fans one notification out to every holder of a role (welfare team,
 * secretaries, …) in a single insert.
 */
export async function notifyRole(
  role: "member" | "subunit_leader" | "secretary" | "welfare" | "super_admin",
  notification: Omit<NotifyInput, "userId">
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("user_roles").select("user_id").eq("role", role);
    if (error) {
      console.error(`[notify] could not list ${role} holders:`, error.message);
      return;
    }
    await notifyMany((data ?? []).map((r) => ({ ...notification, userId: r.user_id })));
  } catch (e) {
    console.error(`[notify] unexpected failure notifying ${role}:`, e);
  }
}
