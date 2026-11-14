"use server";

import { revalidatePath } from "next/cache";
import { getSessionRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Pausing and restoring a course-only learner.
 *
 * Pausing keeps everything — progress, submissions, certificates — and simply
 * stops the account using the academy; its certificates stop verifying while
 * it is paused. There is deliberately no delete: a learner's certificate may
 * already be on somebody's CV, and the check page must be able to say what
 * happened to it.
 */
async function requireAdmin() {
  const session = await getSessionRoles();
  if (!session?.roles.includes("super_admin")) throw new Error("Only a super admin can do this.");
  return session;
}

export async function setLearnerSuspended(
  learnerId: string,
  suspended: boolean,
  reason?: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    const admin = createAdminClient();
    const { error } = await admin
      .from("learners")
      .update(
        suspended
          ? {
              suspended_at: new Date().toISOString(),
              suspended_reason: reason?.trim() || "Paused by an administrator.",
              updated_at: new Date().toISOString(),
            }
          : { suspended_at: null, suspended_reason: null, updated_at: new Date().toISOString() }
      )
      .eq("id", learnerId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin/learners");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not change that." };
  }
}
