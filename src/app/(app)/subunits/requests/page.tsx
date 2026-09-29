import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionRoles } from "@/lib/auth";
import { fetchAllRows } from "@/lib/pagination";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { RequestQueue, type QueueRequest } from "./request-queue";

export default async function SubunitRequestsPage() {
  const session = await getSessionRoles();
  if (!session) return null;

  const canReview =
    session.roles.includes("super_admin") ||
    session.roles.includes("secretary") ||
    session.ledSubunitIds.length > 0;
  if (!canReview) redirect("/subunits");

  const supabase = await createClient();
  const admin = createAdminClient();

  // RLS already scopes this to requests the caller may see: their own, plus any
  // for a subunit they lead; secretaries and super admins see everything.
  const requests = await fetchAllRows<{
    id: string;
    user_id: string;
    subunit_id: string;
    current_subunit_id: string | null;
    status: string;
    reason: string | null;
    decision_note: string | null;
    created_at: string;
    decided_at: string | null;
  }>((from, to) =>
    supabase
      .from("subunit_requests")
      .select(
        "id, user_id, subunit_id, current_subunit_id, status, reason, decision_note, created_at, decided_at"
      )
      .order("created_at", { ascending: false })
      .range(from, to)
  );

  const userIds = [...new Set(requests.map((r) => r.user_id))];
  const subunitIds = [
    ...new Set(
      requests.flatMap((r) => [r.subunit_id, r.current_subunit_id].filter((v): v is string => !!v))
    ),
  ];

  const [{ data: profiles }, { data: subunits }] = await Promise.all([
    userIds.length
      ? admin.from("profiles").select("id, full_name, whatsapp_number").in("id", userIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string; whatsapp_number: string | null }[] }),
    subunitIds.length
      ? admin.from("subunits").select("id, name").in("id", subunitIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const subunitName = new Map((subunits ?? []).map((s) => [s.id, s.name]));

  const rows: QueueRequest[] = requests.map((r) => ({
    id: r.id,
    memberName: nameById.get(r.user_id) ?? "Member",
    fromSubunit: r.current_subunit_id ? subunitName.get(r.current_subunit_id) ?? null : null,
    toSubunit: subunitName.get(r.subunit_id) ?? "—",
    status: r.status as QueueRequest["status"],
    reason: r.reason,
    decisionNote: r.decision_note,
    createdAt: r.created_at,
  }));

  const pending = rows.filter((r) => r.status === "pending");
  const decided = rows.filter((r) => r.status !== "pending").slice(0, 25);

  return (
    <div>
      <PageHeader
        title="Subunit change requests"
        description="Members asking to move to a different primary subunit."
      />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--text-muted)]">
            No change requests. They appear here when a member asks to move subunit.
          </CardContent>
        </Card>
      ) : (
        <RequestQueue pending={pending} decided={decided} />
      )}
    </div>
  );
}
