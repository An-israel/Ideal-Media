import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/pagination";
import { PageHeader } from "@/components/app/page-header";
import { ReviewClient } from "./review-client";
import type { AiProposal } from "@/lib/database.types";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ uploadId: string }>;
}) {
  const { uploadId } = await params;
  const supabase = await createClient();

  const { data: upload } = await supabase
    .from("attendance_uploads")
    .select("id, status, service_date, ai_proposal, parse_error, activities(name)")
    .eq("id", uploadId)
    .single();
  if (!upload) notFound();
  if (upload.status === "committed") redirect("/secretary/attendance");

  // Paged so a large roster isn't silently cut off at 1000 (AUDIT PERF-2).
  const roster = await fetchAllRows<{ id: string; full_name: string }>((from, to) =>
    supabase
      .from("profiles")
      .select("id, full_name")
      .in("member_status", ["active", "traveled"])
      .order("full_name")
      .range(from, to)
  );

  const activityName =
    (upload as unknown as { activities: { name: string } | null }).activities?.name ?? "Activity";

  return (
    <div>
      <PageHeader
        title="Review attendance"
        description={`${activityName} · ${upload.service_date}`}
      />
      <ReviewClient
        uploadId={upload.id}
        proposal={
          (upload.ai_proposal as AiProposal) ?? {
            matches: [],
            unmatched_sheet_rows: [],
            roster_not_on_sheet: [],
          }
        }
        roster={roster}
        parseError={upload.parse_error}
      />
    </div>
  );
}
