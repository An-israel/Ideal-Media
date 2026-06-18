import { createAdminClient } from "@/lib/supabase/admin";
import { RolesClient, type MemberRoles } from "./roles-client";
import type { Role } from "@/lib/database.types";

export default async function RolesPage() {
  const admin = createAdminClient();

  const [{ data: profiles }, { data: roleRows }, { data: subunits }, { data: leaderRows }] =
    await Promise.all([
      admin.from("profiles").select("id, full_name").order("full_name"),
      admin.from("user_roles").select("user_id, role"),
      admin.from("subunits").select("id, name").order("category").order("name"),
      admin
        .from("subunit_members")
        .select("user_id, subunit_id")
        .eq("role_in_subunit", "leader"),
    ]);

  const rolesByUser = new Map<string, Role[]>();
  for (const r of roleRows ?? []) {
    const list = rolesByUser.get(r.user_id) ?? [];
    list.push(r.role as Role);
    rolesByUser.set(r.user_id, list);
  }
  const ledByUser = new Map<string, string[]>();
  for (const l of leaderRows ?? []) {
    const list = ledByUser.get(l.user_id) ?? [];
    list.push(l.subunit_id);
    ledByUser.set(l.user_id, list);
  }

  const members: MemberRoles[] = (profiles ?? []).map((p) => ({
    id: p.id,
    name: p.full_name,
    roles: rolesByUser.get(p.id) ?? [],
    ledSubunitIds: ledByUser.get(p.id) ?? [],
  }));

  return <RolesClient members={members} subunits={subunits ?? []} />;
}
