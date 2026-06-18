"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionRoles } from "@/lib/auth";
import type { MemberStatus } from "@/lib/database.types";

export async function setMemberStatus(userIds: string[], status: MemberStatus) {
  const session = await getSessionRoles();
  if (!session) throw new Error("Not authenticated");
  if (!session.roles.includes("secretary") && !session.roles.includes("super_admin")) {
    throw new Error("Secretary access required");
  }
  if (userIds.length === 0) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ member_status: status })
    .in("id", userIds);
  if (error) throw new Error(error.message);

  revalidatePath("/secretary/roster");
}
