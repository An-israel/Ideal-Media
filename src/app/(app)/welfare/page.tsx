import { PageHeader } from "@/components/app/page-header";
import { PhasePlaceholder } from "@/components/app/phase-placeholder";

export default function WelfarePage() {
  return (
    <div>
      <PageHeader
        title="Welfare"
        description="Auto-populated follow-up board."
      />
      <PhasePlaceholder
        phase="Phase 6 — Welfare board"
        note="New-member and missed-service follow-ups (auto-flagged) surface here with level/status tracking, notes, and assignment. New-member flags are already being created at signup."
      />
    </div>
  );
}
