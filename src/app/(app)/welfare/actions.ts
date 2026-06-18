"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionRoles } from "@/lib/auth";
import { notify } from "@/lib/notify";
import type { WelfareFollowup, WelfareStatus } from "@/lib/database.types";

async function requireWelfare() {
  const session = await getSessionRoles();
  if (!session) throw new Error("Not authenticated");
  if (!session.roles.includes("welfare") && !session.roles.includes("super_admin")) {
    throw new Error("Welfare access required");
  }
  return session;
}

export async function updateFollowup(
  id: string,
  patch: {
    level?: number;
    status?: WelfareStatus;
    notes?: string;
    assignedTo?: string | null;
    markContacted?: boolean;
  }
) {
  await requireWelfare();
  const supabase = await createClient();

  const update: Partial<WelfareFollowup> = {};
  if (patch.level !== undefined) update.level = patch.level;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.assignedTo !== undefined) update.assigned_to = patch.assignedTo;
  if (patch.markContacted) update.last_contact_at = new Date().toISOString();

  const { error } = await supabase.from("welfare_followups").update(update).eq("id", id);
  if (error) throw new Error(error.message);

  // Notify a newly-assigned welfare team member (Section 13).
  if (patch.assignedTo) {
    await notify({
      userId: patch.assignedTo,
      type: "welfare_assigned",
      title: "Welfare follow-up assigned to you",
      body: "A follow-up has been assigned to you.",
      link: "/welfare",
    });
  }

  revalidatePath("/welfare");
}
