import { PageHeader } from "@/components/app/page-header";
import { PhasePlaceholder } from "@/components/app/phase-placeholder";

export default function AdminPage() {
  return (
    <div>
      <PageHeader
        title="Admin"
        description="Roles, subunits, activities, code of conduct, and global analytics."
      />
      <PhasePlaceholder
        phase="Phase 7 — Super admin"
        note="Role management, subunit/activity editing, the missed-service threshold, COC + question-bank management, and global analytics land here. The route is role-gated to super admins."
      />
    </div>
  );
}
