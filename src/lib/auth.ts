import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/constants";

export interface SessionRoles {
  userId: string;
  roles: Role[];
  ledSubunitIds: string[];
  cocCompleted: boolean;
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

  const [{ data: roleRows }, { data: ledRows }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    supabase
      .from("subunit_members")
      .select("subunit_id")
      .eq("user_id", user.id)
      .eq("role_in_subunit", "leader"),
    supabase.from("profiles").select("coc_completed").eq("id", user.id).single(),
  ]);

  return {
    userId: user.id,
    roles: (roleRows ?? []).map((r) => r.role as Role),
    ledSubunitIds: (ledRows ?? []).map((r) => r.subunit_id),
    cocCompleted: profile?.coc_completed ?? false,
  };
}

export function hasRole(session: SessionRoles | null, role: Role): boolean {
  return !!session?.roles.includes(role);
}
