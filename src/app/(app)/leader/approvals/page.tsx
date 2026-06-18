import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { ApprovalsClient, type SubmissionItem, type ApplicationItem } from "./approvals-client";

export default async function ApprovalsPage() {
  const supabase = await createClient();

  const [{ data: submissions }, { data: applications }] = await Promise.all([
    supabase
      .from("module_progress")
      .select("id, submitted_at, user_id, profiles(full_name), modules(title, position, courses(title))")
      .eq("status", "submitted")
      .order("submitted_at", { ascending: true }),
    supabase
      .from("enrollments")
      .select("id, application_reason, user_id, profiles(full_name), courses(title)")
      .eq("status", "pending_application")
      .order("created_at", { ascending: true }),
  ]);

  type SubRow = {
    id: string;
    submitted_at: string | null;
    profiles: { full_name: string } | null;
    modules: { title: string; position: number; courses: { title: string } | null } | null;
  };
  type AppRow = {
    id: string;
    application_reason: string | null;
    profiles: { full_name: string } | null;
    courses: { title: string } | null;
  };

  const subs: SubmissionItem[] = ((submissions ?? []) as unknown as SubRow[]).map((s) => ({
    id: s.id,
    memberName: s.profiles?.full_name ?? "Member",
    moduleTitle: s.modules?.title ?? "Module",
    modulePosition: s.modules?.position ?? 0,
    courseTitle: s.modules?.courses?.title ?? "Course",
    submittedAt: s.submitted_at,
  }));

  const apps: ApplicationItem[] = ((applications ?? []) as unknown as AppRow[]).map((a) => ({
    id: a.id,
    memberName: a.profiles?.full_name ?? "Member",
    courseTitle: a.courses?.title ?? "Course",
    reason: a.application_reason ?? "",
  }));

  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Assignment submissions and secondary-course applications for your subunit."
      />
      <ApprovalsClient submissions={subs} applications={apps} />
    </div>
  );
}
