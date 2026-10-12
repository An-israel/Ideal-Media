import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/constants";

export interface SessionRoles {
  userId: string;
  roles: Role[];
  ledSubunitIds: string[];
  cocCompleted: boolean;
  accessRevoked: boolean;
}

/**
 * Returns the signed-in user's roles + the subunits they lead. Used by
 * middleware and route handlers to gate the /admin, /leader, /secretary,
 * /welfare groups (defense in depth alongside RLS).
 */
export async function getSessionRoles(): Promise<SessionRoles | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: roleRows }, { data: ledRows }, { data: profile }, revoked] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    supabase
      .from("subunit_members")
      .select("subunit_id")
      .eq("user_id", user.id)
      .eq("role_in_subunit", "leader"),
    supabase.from("profiles").select("coc_completed").eq("id", user.id).single(),
    // Deliberately a SEPARATE query, and its failure is tolerated.
    //
    // access_revoked_at arrives with migration 0015. Folding it into the
    // select above meant that on a database which had not run that migration
    // yet, PostgREST rejected the WHOLE query — so coc_completed came back
    // undefined, every page decided the Code of Conduct was outstanding, and
    // the entire site redirected to /coc. This function runs on every request,
    // so it must never depend on the newest column having been added.
    supabase.from("profiles").select("access_revoked_at").eq("id", user.id).maybeSingle(),
  ]);

  return {
    userId: user.id,
    roles: (roleRows ?? []).map((r) => r.role as Role),
    ledSubunitIds: (ledRows ?? []).map((r) => r.subunit_id),
    cocCompleted: profile?.coc_completed ?? false,
    // Set once the member is no longer part of the unit. Checked by the app
    // layout, so a session issued before revocation stops working. Absent
    // before migration 0015, in which case nobody is revoked.
    accessRevoked:
      (revoked.data as { access_revoked_at?: string | null } | null)?.access_revoked_at != null,
  };
}
