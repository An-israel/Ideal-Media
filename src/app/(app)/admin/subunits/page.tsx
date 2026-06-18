import { createAdminClient } from "@/lib/supabase/admin";
import { SubunitsClient } from "./subunits-client";
import type { SubunitCategory } from "@/lib/database.types";

export default async function SubunitsPage() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("subunits")
    .select("id, name, category")
    .order("category")
    .order("name");
  return (
    <SubunitsClient
      subunits={(data ?? []) as { id: string; name: string; category: SubunitCategory }[]}
    />
  );
}
