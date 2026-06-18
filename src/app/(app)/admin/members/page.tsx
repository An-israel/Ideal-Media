import { createAdminClient } from "@/lib/supabase/admin";
import { MembersClient, type AdminMemberRow } from "./members-client";
import type { MemberStatus } from "@/lib/database.types";

export default async function AdminMembersPage() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("subunit_members")
    .select("user_id, profiles(full_name, email, member_status), subunits(name)")
    .eq("membership_type", "primary");

  type Row = {
    user_id: string;
    profiles: { full_name: string; email: string; member_status: MemberStatus } | null;
    subunits: { name: string } | null;
  };
  const rows: AdminMemberRow[] = ((data ?? []) as unknown as Row[])
    .filter((r) => r.profiles)
    .map((r) => ({
      id: r.user_id,
      name: r.profiles!.full_name,
      email: r.profiles!.email,
      status: r.profiles!.member_status,
      subunit: r.subunits?.name ?? "—",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return <MembersClient rows={rows} />;
}
