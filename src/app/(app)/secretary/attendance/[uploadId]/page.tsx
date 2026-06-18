import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
    .select("id, status, service_date, ai_proposal, activities(name)")
    .eq("id", uploadId)
    .single();
  if (!upload) notFound();
  if (upload.status === "committed") redirect("/secretary/attendance");

  const { data: roster } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("member_status", ["active", "traveled"])
    .order("full_name");

  return (
    <div>
      <PageHeader
        title="Review attendance"
        // @ts-expect-error supabase embed typing
        description={`${upload.activities?.name ?? "Activity"} · ${upload.service_date}`}
      />
      <ReviewClient
        uploadId={upload.id}
        proposal={(upload.ai_proposal as AiProposal) ?? { matches: [], unmatched_sheet_rows: [], roster_not_on_sheet: [] }}
        roster={roster ?? []}
      />
    </div>
  );
}
