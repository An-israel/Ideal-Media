import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/pagination";
import { RolesClient, type MemberRoles } from "./roles-client";
import type { Role } from "@/lib/database.types";

export default async function RolesPage() {
  const admin = createAdminClient();

  // Paged — an unbounded select silently caps at 1000 rows, so past 1000
  // members the role manager just stopped listing people (AUDIT PERF-2).
  const [profiles, roleRows, subunits, leaderRows] = await Promise.all([
    fetchAllRows<{ id: string; full_name: string }>((from, to) =>
      admin.from("profiles").select("id, full_name").order("full_name").range(from, to)
    ),
    fetchAllRows<{ user_id: string; role: string }>((from, to) =>
      admin.from("user_roles").select("user_id, role").range(from, to)
    ),
    fetchAllRows<{ id: string; name: string }>((from, to) =>
      admin.from("subunits").select("id, name").order("category").order("name").range(from, to)
    ),
    fetchAllRows<{ user_id: string; subunit_id: string }>((from, to) =>
      admin
        .from("subunit_members")
        .select("user_id, subunit_id")
        .eq("role_in_subunit", "leader")
        .range(from, to)
    ),
  ]);

  const rolesByUser = new Map<string, Role[]>();
  for (const r of roleRows) {
    const list = rolesByUser.get(r.user_id) ?? [];
    list.push(r.role as Role);
    rolesByUser.set(r.user_id, list);
  }
  const ledByUser = new Map<string, string[]>();
  for (const l of leaderRows) {
    const list = ledByUser.get(l.user_id) ?? [];
    list.push(l.subunit_id);
    ledByUser.set(l.user_id, list);
  }

  const members: MemberRoles[] = profiles.map((p) => ({
    id: p.id,
    name: p.full_name,
    roles: rolesByUser.get(p.id) ?? [],
    ledSubunitIds: ledByUser.get(p.id) ?? [],
  }));

  return <RolesClient members={members} subunits={subunits} />;
}
