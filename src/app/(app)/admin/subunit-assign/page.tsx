import { notFound } from "next/navigation";
import { getSessionRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/app/page-header";
import { AssignFlow } from "./assign-flow";

export default async function SubunitAssignPage() {
  const session = await getSessionRoles();
  if (!session) return null;
  if (!session.roles.includes("super_admin")) notFound();

  const admin = createAdminClient();
  const { data: subunits } = await admin
    .from("subunits")
    .select("id, name, category")
    .order("category")
    .order("name");

  return (
    <div>
      <PageHeader
        title="Assign subunits"
        description="Paste a unit's member sheet and assign everyone on it. Nothing changes until you approve it."
      />
      <AssignFlow subunits={subunits ?? []} />
    </div>
  );
}
