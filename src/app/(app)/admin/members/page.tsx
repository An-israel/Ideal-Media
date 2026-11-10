import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/pagination";
import { getInstructorsMissingWhatsApp } from "../actions";
import { MembersClient, type AdminMemberRow } from "./members-client";
import { MissingWhatsAppPanel } from "./missing-whatsapp";
import type { MemberStatus } from "@/lib/database.types";

export default async function AdminMembersPage() {
  const admin = createAdminClient();
  const missingWhatsApp = await getInstructorsMissingWhatsApp();
  // Every profile, with the primary subunit looked up beside it. Reading from
  // subunit_members instead left out anyone with no primary subunit — who are
  // exactly the people an admin needs to find here: accounts created ahead of
  // their unit, and members restored without the membership they used to hold.
  const [profiles, memberships] = await Promise.all([
    fetchAllRows<{ id: string; full_name: string; email: string; member_status: MemberStatus }>(
      (from, to) =>
        admin
          .from("profiles")
          .select("id, full_name, email, member_status")
          .order("id")
          .range(from, to)
    ),
    fetchAllRows<{ user_id: string; subunits: { name: string } | null }>((from, to) =>
      admin
        .from("subunit_members")
        .select("user_id, subunits(name)")
        .eq("membership_type", "primary")
        .order("user_id")
        .range(from, to) as unknown as PromiseLike<{
        data: { user_id: string; subunits: { name: string } | null }[] | null;
        error: { message: string } | null;
      }>
    ),
  ]);

  const primaryOf = new Map(memberships.map((m) => [m.user_id, m.subunits?.name ?? null]));
  const rows: AdminMemberRow[] = profiles
    .map((p) => ({
      id: p.id,
      name: p.full_name,
      // Members added from a list have a placeholder address until they claim
      // the account; showing it as if it were theirs is just noise.
      email: p.email.endsWith("@no-email.ideal-media.app") ? "" : p.email,
      status: p.member_status,
      subunit: primaryOf.get(p.id) ?? "No subunit yet",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <MissingWhatsAppPanel rows={missingWhatsApp} />
      <MembersClient rows={rows} />
    </div>
  );
}
