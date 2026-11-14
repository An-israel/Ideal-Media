"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAcademyUser } from "@/lib/academy-user";
import { normalizePhone } from "@/lib/phone";

/** A learner corrects their own name and phone. Nothing else is editable here. */
export async function updateLearnerAccount(input: {
  fullName: string;
  phone: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await getAcademyUser();
  // A member's name lives on their profile and is changed in the main app.
  if (!user || user.kind !== "learner") return { ok: false, error: "Please log in again." };

  const fullName = input.fullName.trim().replace(/\s+/g, " ");
  const phone = input.phone.trim();
  if (fullName.length < 2 || fullName.length > 80) {
    return { ok: false, error: "Please enter your full name." };
  }
  if (phone && !normalizePhone(phone)) return { ok: false, error: "That phone number doesn't look right." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("learners")
    .update({ full_name: fullName, phone: phone || null, updated_at: new Date().toISOString() })
    .eq("id", user.userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/learn", "layout");
  return { ok: true };
}
