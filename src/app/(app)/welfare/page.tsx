import { createClient } from "@/lib/supabase/server";
import { getWelfareTeam, getMissedCounts, getBirthdays } from "@/lib/welfare-queries";
import { PageHeader } from "@/components/app/page-header";
import { WelfareBoard, type FollowupItem } from "./welfare-board";
import { AddNewMemberButton } from "./add-new-member-button";
import { BirthdaysPanel } from "./birthdays-panel";
import type { WelfareReason, WelfareStatus } from "@/lib/database.types";

export default async function WelfarePage() {
  const supabase = await createClient();

  const { data: followups } = await supabase
    .from("welfare_followups")
    .select(
      "id, reason, level, status, notes, assigned_to, last_contact_at, created_at, user_id, profiles!welfare_followups_user_id_fkey(full_name, whatsapp_number, member_status)"
    )
    .neq("status", "resolved")
    .order("created_at", { ascending: false });

  type Row = {
    id: string;
    reason: WelfareReason;
    level: number;
    status: WelfareStatus;
    notes: string | null;
    assigned_to: string | null;
    last_contact_at: string | null;
    created_at: string;
    user_id: string;
    profiles: { full_name: string; whatsapp_number: string | null; member_status: string } | null;
  };
  const rows = (followups ?? []) as unknown as Row[];

  const [team, missed, { data: primarySubunits }, birthdays] = await Promise.all([
    getWelfareTeam(),
    getMissedCounts(rows.filter((r) => r.reason === "missed_service").map((r) => r.user_id)),
    supabase.from("subunits").select("id, name").eq("category", "primary").order("name"),
    getBirthdays(supabase),
  ]);

  const items: FollowupItem[] = rows.map((r) => ({
    id: r.id,
    memberName: r.profiles?.full_name ?? "Member",
    whatsapp: r.profiles?.whatsapp_number ?? null,
    reason: r.reason,
    level: r.level,
    status: r.status,
    notes: r.notes ?? "",
    assignedTo: r.assigned_to,
    lastContactAt: r.last_contact_at,
    createdAt: r.created_at,
    missedCount: r.reason === "missed_service" ? missed.get(r.user_id) ?? null : null,
  }));

  return (
    <div>
      <PageHeader
        title="Welfare"
        description="Members flagged for follow-up — auto-populated."
        action={<AddNewMemberButton subunits={primarySubunits ?? []} />}
      />
      <BirthdaysPanel today={birthdays.today} upcoming={birthdays.upcoming} />
      <WelfareBoard items={items} team={team} />
    </div>
  );
}
