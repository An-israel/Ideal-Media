import { PageHeader } from "@/components/app/page-header";
import { PhasePlaceholder } from "@/components/app/phase-placeholder";

export default function SecretaryPage() {
  return (
    <div>
      <PageHeader
        title="Secretary"
        description="Attendance uploads and roster management."
      />
      <PhasePlaceholder
        phase="Phase 5 & 6 — Attendance + roster"
        note="The AI attendance pipeline (upload → SheetJS → Claude tool-use → review → commit) and member-status roster management land here. The route is role-gated to the secretary."
      />
    </div>
  );
}
