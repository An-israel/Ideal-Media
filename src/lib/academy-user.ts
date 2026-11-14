import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Who is using the Skills Academy: a member of the media department, or a
 * course-only learner.
 *
 * The two live in different tables on purpose. A member has a profile — the
 * record the roster, attendance and welfare all hang off. A learner has a row
 * in `learners` and no profile at all, so nothing in the department's records
 * can ever reach them (see migration 0020). The academy is the one place both
 * are allowed, so it asks this instead of getSessionRoles(), which answers
 * only for members.
 */

export interface AcademyUser {
  userId: string;
  kind: "member" | "learner";
  fullName: string;
}

export type AcademyUserState =
  | { status: "ok"; user: AcademyUser }
  | { status: "signed-out" }
  /** A member who has not yet accepted the Code of Conduct, or whose access was removed. */
  | { status: "member-blocked" }
  | { status: "learner-suspended"; reason: string | null }
  /** Signed in, but neither a member nor a learner. */
  | { status: "unknown" };

export async function getAcademyUserState(): Promise<AcademyUserState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "signed-out" };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, coc_completed")
    .eq("id", user.id)
    .maybeSingle();

  if (profile) {
    // Read on its own and tolerated if it fails, like getSessionRoles: the
    // column arrives with a migration and must never decide on its own that
    // every member is locked out.
    const { data: access } = await admin
      .from("profiles")
      .select("access_revoked_at")
      .eq("id", user.id)
      .maybeSingle();
    const revoked =
      (access as { access_revoked_at?: string | null } | null)?.access_revoked_at != null;
    if (revoked || !profile.coc_completed) return { status: "member-blocked" };
    return { status: "ok", user: { userId: user.id, kind: "member", fullName: profile.full_name } };
  }

  // Tolerated as well: before migration 0020 the table does not exist, and
  // that must read as "not a learner", not as an error page.
  const { data: learner, error } = await admin
    .from("learners")
    .select("full_name, suspended_at, suspended_reason")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !learner) return { status: "unknown" };
  if (learner.suspended_at) {
    return { status: "learner-suspended", reason: learner.suspended_reason };
  }
  return { status: "ok", user: { userId: user.id, kind: "learner", fullName: learner.full_name } };
}

/** The user, or null for anyone who may not use the academy right now. */
export async function getAcademyUser(): Promise<AcademyUser | null> {
  const state = await getAcademyUserState();
  return state.status === "ok" ? state.user : null;
}
