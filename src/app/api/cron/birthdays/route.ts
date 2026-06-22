import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Daily birthday reminder for the welfare team. Hit by Vercel Cron (see
 * vercel.json). Creates an in-app notification for each welfare member on
 * anyone's birthday — once per day (deduped via app_settings).
 *
 * If CRON_SECRET is set, the request must carry `Authorization: Bearer <secret>`
 * (Vercel Cron sends this automatically). If unset, the route is open.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const todayKey = now.toISOString().slice(0, 10);

  // Run at most once per day.
  const { data: setting } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "birthday_notified_on")
    .maybeSingle();
  if (setting && String(setting.value).replace(/"/g, "") === todayKey) {
    return NextResponse.json({ ok: true, skipped: "already ran today" });
  }

  const { data: celebrants } = await admin
    .from("profiles")
    .select("full_name")
    .eq("member_status", "active")
    .eq("birth_month", month)
    .eq("birth_day", day);

  await admin
    .from("app_settings")
    .upsert(
      { key: "birthday_notified_on", value: todayKey, updated_at: now.toISOString() },
      { onConflict: "key" }
    );

  if (!celebrants || celebrants.length === 0) {
    return NextResponse.json({ ok: true, birthdays: 0 });
  }

  const names = celebrants.map((c) => c.full_name).join(", ");
  const { data: welfare } = await admin.from("user_roles").select("user_id").eq("role", "welfare");

  for (const w of welfare ?? []) {
    await admin.from("notifications").insert({
      user_id: w.user_id,
      type: "birthday_today",
      title: "🎂 Birthday today",
      body:
        celebrants.length === 1
          ? `It's ${names}'s birthday today — reach out and celebrate them!`
          : `Birthdays today: ${names}. Reach out and celebrate them!`,
      link: "/welfare",
    });
  }

  return NextResponse.json({ ok: true, birthdays: celebrants.length, notified: (welfare ?? []).length });
}
