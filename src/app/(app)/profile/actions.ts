"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionRoles } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import type { Profile } from "@/lib/database.types";

export interface ProfileInput {
  fullName: string;
  phone: string;
  whatsappNumber: string;
  location: string;
  /** Month/day only — the year isn't collected. */
  birthMonth: string;
  birthDay: string;
}

export interface ProfileResult {
  ok: boolean;
  error?: string;
  message?: string;
  /** The WhatsApp number as it will actually be dialled, so they can check it. */
  normalizedWhatsapp?: string | null;
}

/**
 * Updates the signed-in member's own profile.
 *
 * This page exists because nothing else in the app could write
 * `whatsapp_number` after signup. A leader who skipped that field, or typed it
 * wrong, had no way to fix it — and since assignment submissions are handed off
 * over WhatsApp, their whole course had no working submission route and the
 * member just saw "your leader has no WhatsApp number on file".
 *
 * The number is stored as the member typed it (so it still looks familiar) but
 * validated through `normalizePhone` first, and the international form is
 * echoed back so they can confirm it's the number they meant.
 */
export async function updateOwnProfile(input: ProfileInput): Promise<ProfileResult> {
  const session = await getSessionRoles();
  if (!session) return { ok: false, error: "Not authenticated" };

  const fullName = input.fullName.trim();
  if (!fullName) return { ok: false, error: "Your name can't be blank." };

  const whatsappRaw = input.whatsappNumber.trim();
  let normalizedWhatsapp: string | null = null;
  if (whatsappRaw) {
    normalizedWhatsapp = normalizePhone(whatsappRaw);
    if (!normalizedWhatsapp) {
      return {
        ok: false,
        error:
          "That WhatsApp number doesn't look right. Use the number as you'd dial it, e.g. 08031234567 or +2348031234567.",
      };
    }
  }

  const phoneRaw = input.phone.trim();
  if (phoneRaw && !normalizePhone(phoneRaw)) {
    return { ok: false, error: "That phone number doesn't look right." };
  }

  // Birthday is optional, but if one field is given both must be.
  const month = input.birthMonth ? Number(input.birthMonth) : null;
  const day = input.birthDay ? Number(input.birthDay) : null;
  if ((month === null) !== (day === null)) {
    return { ok: false, error: "Give both the birthday month and day, or neither." };
  }
  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) {
    return { ok: false, error: "Birthday month must be between 1 and 12." };
  }
  if (day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) {
    return { ok: false, error: "Birthday day must be between 1 and 31." };
  }

  const update: Partial<Profile> = {
    full_name: fullName,
    phone: phoneRaw || null,
    whatsapp_number: whatsappRaw || null,
    location: input.location.trim() || null,
    birth_month: month,
    birth_day: day,
  };

  // RLS: profiles_update_self scopes this to their own row.
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update(update).eq("id", session.userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/profile");
  revalidatePath("/dashboard");
  // A changed WhatsApp number changes the submission link on their courses.
  revalidatePath("/leader/courses");
  revalidatePath("/courses");

  return {
    ok: true,
    message: "Profile saved.",
    normalizedWhatsapp,
  };
}
