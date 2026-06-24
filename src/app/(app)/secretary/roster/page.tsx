import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RosterTable, type RosterRow } from "./roster-table";
import type { MemberStatus } from "@/lib/database.types";

export default async function RosterPage() {
  const supabase = await createClient();

  const { data: members } = await supabase
    .from("subunit_members")
    .select("user_id, profiles(full_name, member_status, location, member_origin, claimed), subunits(name)")
    .eq("membership_type", "primary")
    .order("user_id");

  const { data: subunits } = await supabase
    .from("subunits")
    .select("id, name")
    .eq("category", "primary")
    .order("name");

  type Row = {
    user_id: string;
    profiles: {
      full_name: string;
      member_status: MemberStatus;
      location: string | null;
      member_origin: string;
      claimed: boolean;
    } | null;
    subunits: { name: string } | null;
  };
  const rows: RosterRow[] = ((members ?? []) as unknown as Row[])
    .filter((r) => r.profiles)
    .map((r) => ({
      id: r.user_id,
      name: r.profiles!.full_name,
      status: r.profiles!.member_status,
      location: r.profiles!.location,
      subunit: r.subunits?.name ?? "—",
      origin: r.profiles!.member_origin,
      claimed: r.profiles!.claimed,
    }));

  // "Recently missed service": absentees on the latest signal-activity session.
  const { data: signal } = await supabase
    .from("activities")
    .select("id")
    .eq("is_attendance_signal", true)
    .limit(1)
    .maybeSingle();

  let recentlyMissed: string[] = [];
  if (signal) {
    const { data: latest } = await supabase
      .from("attendance_records")
      .select("service_date")
      .eq("activity_id", signal.id)
      .order("service_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest) {
      const { data: absentees } = await supabase
        .from("attendance_records")
        .select("user_id, profiles(full_name)")
        .eq("activity_id", signal.id)
        .eq("service_date", latest.service_date)
        .eq("status", "absent");
      type A = { profiles: { full_name: string } | null };
      recentlyMissed = ((absentees ?? []) as unknown as A[])
        .map((a) => a.profiles?.full_name)
        .filter((n): n is string => !!n);
    }
  }

  return (
    <div>
      <PageHeader title="Roster" description="Categorize members and review who's missing service." />

      {recentlyMissed.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Absent at the most recent service ({recentlyMissed.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {recentlyMissed.map((n, i) => (
              <span key={i} className="rounded-full bg-[var(--bg)] px-3 py-1 text-sm text-[var(--text-muted)]">
                {n}
              </span>
            ))}
          </CardContent>
        </Card>
      )}

      <RosterTable rows={rows} subunits={subunits ?? []} />
    </div>
  );
}
