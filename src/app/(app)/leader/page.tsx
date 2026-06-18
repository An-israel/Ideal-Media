import { PageHeader } from "@/components/app/page-header";
import { PhasePlaceholder } from "@/components/app/phase-placeholder";

export default function LeaderPage() {
  return (
    <div>
      <PageHeader
        title="Leader"
        description="Members, approvals, attendance, and your course builder."
      />
      <PhasePlaceholder
        phase="Phase 4 — Leader dashboard"
        note="Members list, the approvals queue (assignment submissions + secondary-course applications), the read-only attendance view, and the course builder land here. The route is already role-gated to subunit leaders."
      />
    </div>
  );
}
