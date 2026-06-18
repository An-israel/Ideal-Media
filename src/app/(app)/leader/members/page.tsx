import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionRoles } from "@/lib/auth";
import { getMemberPerformance } from "@/lib/queries";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { pct } from "@/lib/performance";
import type { MemberStatus } from "@/lib/database.types";

const STATUS_VARIANT: Record<MemberStatus, "success" | "neutral" | "warning" | "danger"> = {
  active: "success",
  inactive: "neutral",
  traveled: "warning",
  graduated: "neutral",
  left: "danger",
};

export default async function LeaderMembersPage() {
  const session = await getSessionRoles();
  if (!session) return null;
  const supabase = await createClient();
  const isAdmin = session.roles.includes("super_admin");

  // Members of the subunits this user leads (RLS also scopes this).
  let query = supabase
    .from("subunit_members")
    .select("user_id, membership_type, role_in_subunit, subunits(name), profiles(full_name, member_status)");
  if (!isAdmin) {
    query = query.in(
      "subunit_id",
      session.ledSubunitIds.length ? session.ledSubunitIds : ["00000000-0000-0000-0000-000000000000"]
    );
  }
  const { data: rows } = await query;

  type Row = {
    user_id: string;
    membership_type: string;
    role_in_subunit: string;
    subunits: { name: string } | null;
    profiles: { full_name: string; member_status: MemberStatus } | null;
  };
  const memberRows = (rows ?? []) as unknown as Row[];

  // De-duplicate members (a member may appear in multiple led subunits).
  const byUser = new Map<string, Row>();
  for (const r of memberRows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, r);
  }
  const unique = [...byUser.values()];

  // Composite performance per member (RLS lets the leader read their data).
  const performances = await Promise.all(
    unique.map((r) => getMemberPerformance(supabase, r.user_id))
  );

  return (
    <div>
      <PageHeader title="Members" description="Everyone in the subunit(s) you lead." />
      {unique.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--text-muted)]">
            No members found in your subunit(s) yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-[var(--border)]">
              {unique.map((r, i) => {
                const perf = performances[i];
                const status = r.profiles?.member_status ?? "active";
                return (
                  <Link
                    key={r.user_id}
                    href={`/leader/members/${r.user_id}`}
                    className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-[var(--bg)]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {r.profiles?.full_name ?? "Member"}
                        {r.role_in_subunit === "leader" && (
                          <span className="ml-2 text-xs text-[var(--accent)]">Leader</span>
                        )}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">{r.subunits?.name}</p>
                    </div>
                    <div className="hidden text-right sm:block">
                      <p className="text-xs text-[var(--text-muted)]">Progress</p>
                      <p className="text-sm font-medium">{pct(perf.parts.progress)}%</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-[var(--text-muted)]">Performance</p>
                      <p className="text-sm font-medium">{pct(perf.composite)}%</p>
                    </div>
                    <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
