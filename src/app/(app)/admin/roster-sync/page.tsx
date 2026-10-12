import { notFound } from "next/navigation";
import { getSessionRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/pagination";
import { PageHeader } from "@/components/app/page-header";
import { MigrationNotice } from "@/components/app/migration-notice";
import { memberAccessMigrations } from "@/lib/schema-check";
import { RosterSyncFlow } from "./roster-sync-flow";

export default async function RosterSyncPage() {
  const session = await getSessionRoles();
  if (!session) return null;
  if (!session.roles.includes("super_admin")) notFound();

  // Ask before querying: without migration 0015 every read below fails and the
  // page dies with a generic error that says nothing about why.
  const needs = await memberAccessMigrations();
  if (needs.length > 0) {
    return (
      <div>
        <PageHeader
          title="Members list"
          description="Reconcile the site against the official media members list."
        />
        <MigrationNotice needs={needs} />
      </div>
    );
  }

  const admin = createAdminClient();
  const revoked = await fetchAllRows<{
    id: string;
    full_name: string;
    access_revoked_at: string;
    access_revoked_reason: string | null;
  }>((from, to) =>
    admin
      .from("profiles")
      .select("id, full_name, access_revoked_at, access_revoked_reason")
      .not("access_revoked_at", "is", null)
      .order("full_name")
      .range(from, to)
  );

  return (
    <div>
      <PageHeader
        title="Members list"
        description="Reconcile the site against the official media members list. Nothing changes until you approve it."
      />
      <RosterSyncFlow
        alreadyRevoked={revoked.map((r) => ({
          id: r.id,
          fullName: r.full_name,
          revokedAt: r.access_revoked_at,
          reason: r.access_revoked_reason,
        }))}
      />
    </div>
  );
}
