import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionRoles } from "@/lib/auth";
import { fetchAllRows } from "@/lib/pagination";
import { getCourseInstructors } from "@/lib/course-access";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { SubunitsBrowser, type BrowserSubunit } from "./subunits-browser";

export default async function SubunitsPage() {
  const session = await getSessionRoles();
  if (!session) return null;
  const supabase = await createClient();
  const admin = createAdminClient();

  const [{ data: subunits }, { data: myMemberships }, { data: pendingRequest }] =
    await Promise.all([
      supabase
        .from("subunits")
        .select("id, name, slug, category, description")
        .order("category", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("subunit_members")
        .select("subunit_id, membership_type")
        .eq("user_id", session.userId),
      supabase
        .from("subunit_requests")
        .select("id, subunit_id, current_subunit_id, reason, created_at")
        .eq("user_id", session.userId)
        .eq("status", "pending")
        .maybeSingle(),
    ]);

  // Member counts come from a SECURITY DEFINER function: subunit_members rows
  // aren't readable by a plain member, but the totals are safe to show.
  const { data: counts } = await admin.rpc("subunit_member_counts");
  const countBySubunit = new Map(
    (counts ?? []).map((c) => [c.subunit_id, Number(c.member_count)])
  );

  const membershipBySubunit = new Map(
    (myMemberships ?? []).map((m) => [m.subunit_id, m.membership_type])
  );
  const mySubunitIds = [...membershipBySubunit.keys()];

  // Published courses per subunit, and which of them the member already has a
  // relationship with — so the page can show "request this course" accurately.
  const courses = await fetchAllRows<{
    id: string;
    subunit_id: string;
    title: string;
  }>((from, to) =>
    admin
      .from("courses")
      .select("id, subunit_id, title")
      .eq("is_published", true)
      .order("title", { ascending: true })
      .range(from, to)
  );

  const instructors = await getCourseInstructors(supabase);

  const myEnrollments = await fetchAllRows<{ course_id: string; status: string }>((from, to) =>
    supabase.from("enrollments").select("course_id, status").eq("user_id", session.userId).range(from, to)
  );
  const enrollmentByCourse = new Map(myEnrollments.map((e) => [e.course_id, e.status]));

  const rows: BrowserSubunit[] = (subunits ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    description: s.description,
    memberCount: countBySubunit.get(s.id) ?? 0,
    membership:
      (membershipBySubunit.get(s.id) as "primary" | "secondary" | undefined) ?? null,
    courses: courses
      .filter((c) => c.subunit_id === s.id)
      .map((c) => ({
        id: c.id,
        title: c.title,
        instructorName: instructors.get(c.id)?.instructorName ?? null,
        enrollmentStatus: enrollmentByCourse.get(c.id) ?? null,
      })),
  }));

  const canReview =
    session.roles.includes("super_admin") ||
    session.roles.includes("secretary") ||
    session.ledSubunitIds.length > 0;

  return (
    <div>
      <PageHeader
        title="Subunits"
        description="Browse every subunit, join the ones you serve in, and request a move if you're in the wrong one."
      />

      {canReview && (
        <div className="mb-4">
          <Link href="/subunits/requests">
            <Button variant="outline" size="sm">
              <ClipboardCheck className="h-4 w-4" /> Review change requests
            </Button>
          </Link>
        </div>
      )}

      <SubunitsBrowser
        subunits={rows}
        atSubunitLimit={mySubunitIds.length}
        pendingRequest={
          pendingRequest
            ? {
                id: pendingRequest.id,
                subunitId: pendingRequest.subunit_id,
                subunitName:
                  rows.find((r) => r.id === pendingRequest.subunit_id)?.name ?? "another subunit",
                reason: pendingRequest.reason,
              }
            : null
        }
      />
    </div>
  );
}
