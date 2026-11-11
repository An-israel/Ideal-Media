import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/pagination";
import { suggestSubunits, type Suggestion } from "@/lib/subunit-suggestions";
import type { SheetData } from "@/lib/roster-restore";
import memberSheets from "@/data/member-sheets.json";

/**
 * Suggested units for everyone on the roll who has no primary subunit.
 *
 * Reads with the service role because enrolments are not readable by a
 * secretary under row level security — so the CALLER must have checked the
 * role first. Returns an empty list rather than throwing: this decorates the
 * roster, and the roster must still load if it fails.
 */
export async function getSubunitSuggestions(): Promise<Suggestion[]> {
  try {
    const admin = createAdminClient();

    const [profiles, primaries, subunits] = await Promise.all([
      fetchAllRows<{
        id: string;
        full_name: string;
        phone: string | null;
        whatsapp_number: string | null;
        member_status: string;
        access_revoked_at: string | null;
      }>((from, to) =>
        admin
          .from("profiles")
          .select("id, full_name, phone, whatsapp_number, member_status, access_revoked_at")
          .order("id")
          .range(from, to)
      ),
      fetchAllRows<{ user_id: string }>((from, to) =>
        admin
          .from("subunit_members")
          .select("user_id")
          .eq("membership_type", "primary")
          .order("user_id")
          .range(from, to)
      ),
      fetchAllRows<{ id: string; name: string; slug: string; category: string }>((from, to) =>
        admin.from("subunits").select("id, name, slug, category").range(from, to)
      ),
    ]);

    const hasPrimary = new Set(primaries.map((p) => p.user_id));
    const unassigned = profiles.filter(
      (p) =>
        !hasPrimary.has(p.id) &&
        p.access_revoked_at === null &&
        !["left", "graduated"].includes(p.member_status)
    );
    if (unassigned.length === 0) return [];

    const ids = unassigned.map((u) => u.id);
    const [enrollments, courses] = await Promise.all([
      fetchAllRows<{ user_id: string; course_id: string }>((from, to) =>
        admin
          .from("enrollments")
          .select("user_id, course_id")
          .in("user_id", ids)
          .order("id")
          .range(from, to)
      ),
      fetchAllRows<{ id: string; subunit_id: string }>((from, to) =>
        admin.from("courses").select("id, subunit_id").range(from, to)
      ),
    ]);
    const subunitOfCourse = new Map(courses.map((c) => [c.id, c.subunit_id]));

    return suggestSubunits({
      unassigned: unassigned.map((u) => ({
        id: u.id,
        fullName: u.full_name,
        phone: u.phone,
        whatsappNumber: u.whatsapp_number,
      })),
      subunits,
      sheets: memberSheets as SheetData,
      enrollments: enrollments
        .map((e) => ({ userId: e.user_id, subunitId: subunitOfCourse.get(e.course_id) ?? "" }))
        .filter((e) => e.subunitId),
    });
  } catch (e) {
    console.error("[roster] subunit suggestions unavailable:", e);
    return [];
  }
}
