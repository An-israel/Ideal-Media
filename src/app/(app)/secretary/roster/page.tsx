import { PageHeader } from "@/components/app/page-header";
import { PhasePlaceholder } from "@/components/app/phase-placeholder";

export default function RosterPage() {
  return (
    <div>
      <PageHeader title="Roster" description="Member categorization and status." />
      <PhasePlaceholder
        phase="Phase 6 — Roster management"
        note="Bulk member-status changes (active / inactive / traveled / graduated / left) and the 'recently missed service' view land here. Traveled members are excluded from missed-service welfare flags."
      />
    </div>
  );
}
