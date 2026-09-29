import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionRoles } from "@/lib/auth";
import { getTrainingForMember, getTrainingReport } from "@/lib/training";
import { PageHeader } from "@/components/app/page-header";
import { TrainingManager } from "./training-manager";
import { TrainingReportView } from "./training-report";

export default async function AdminTrainingPage() {
  const session = await getSessionRoles();
  if (!session) return null;
  const supabase = await createClient();

  const canManage =
    session.roles.includes("super_admin") || session.roles.includes("secretary");
  // This page lives outside the /admin route group (middleware gates that to
  // super_admin alone), so it guards itself: managers get the full screen,
  // subunit leaders get the report, everyone else is sent back.
  const canSeeReport = canManage || session.ledSubunitIds.length > 0;
  if (!canSeeReport) redirect("/training");

  // RLS lets a manager see drafts too, so includeUnpublished is meaningful here.
  const series = await getTrainingForMember(supabase, session.userId, {
    includeUnpublished: true,
  });
  // A leader sees their own subunits' members; managers see the department.
  const report = await getTrainingReport(
    canManage ? undefined : { subunitIds: session.ledSubunitIds }
  );

  return (
    <div>
      <PageHeader
        title="General Training"
        description={
          canManage
            ? "Add teachings for the whole department, and see who has listened."
            : "Who in your subunit(s) has listened to the general training."
        }
      />

      <TrainingReportView report={report} canManage={canManage} />

      {canManage && (
        <div className="mt-10">
          <TrainingManager
            series={series.map((s) => ({
              id: s.id,
              title: s.title,
              description: s.description,
              isPublished: s.isPublished,
              teachings: s.teachings.map((t) => ({
                id: t.id,
                position: t.position,
                title: t.title,
                description: t.description,
                mediaType: t.mediaType,
                durationSeconds: t.durationSeconds,
                isPublished: t.isPublished,
              })),
            }))}
          />
        </div>
      )}
    </div>
  );
}
