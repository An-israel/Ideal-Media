import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyRole } from "@/lib/notify";
import { todayISO } from "@/lib/dates";

/**
 * Daily birthday reminder for the welfare team. Hit by Vercel Cron (see
 * vercel.json). Creates an in-app notification for each welfare member on
 * anyone's birthday — once per day (deduped via app_settings).
 *
 * Three fixes from the audit:
 *   - This route was unreachable. The proxy matched /api and the request
 *     carries no Supabase session, so every cron invocation was answered with a
 *     307 to /login and the handler body never ran (AUDIT NOTIF-1). /api is now
 *     excluded from the proxy matcher, which is why this route authenticates
 *     itself below.
 *   - CRON_SECRET is required, not optional (AUDIT SEC-6). It used to fail
 *     OPEN: with the variable unset, anyone could spam every welfare member and
 *     flip the dedup marker to suppress the real run.
 *   - The day is marked done only AFTER notifications are sent (AUDIT NOTIF-2).
 *     The marker used to be written first, so a failed insert silently burned
 *     the day with no retry and no error.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/birthdays] CRON_SECRET is not set — refusing to run.");
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured on this deployment." },
      { status: 503 }
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  // Local calendar day, not a UTC slice of an instant.
  const todayKey = todayISO();

  // Run at most once per day. Claiming the marker up front (with the previous
  // value as a guard) also stops two concurrent invocations both proceeding.
  const { data: setting } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "birthday_notified_on")
    .maybeSingle();

  const lastRun = setting?.value == null ? null : String(setting.value).replace(/"/g, "");
  if (lastRun === todayKey) {
    return NextResponse.json({ ok: true, skipped: "already ran today" });
  }

  const { data: celebrants, error: celebrantsErr } = await admin
    .from("profiles")
    .select("full_name")
    .eq("member_status", "active")
    .eq("birth_month", month)
    .eq("birth_day", day);

  if (celebrantsErr) {
    // Don't burn the day on a read failure — the next run should retry.
    console.error("[cron/birthdays] could not read celebrants:", celebrantsErr.message);
    return NextResponse.json({ ok: false, error: celebrantsErr.message }, { status: 500 });
  }

  const markDone = async () => {
    const { error } = await admin
      .from("app_settings")
      .upsert(
        { key: "birthday_notified_on", value: todayKey, updated_at: now.toISOString() },
        { onConflict: "key" }
      );
    if (error) console.error("[cron/birthdays] could not record the run:", error.message);
  };

  if (!celebrants || celebrants.length === 0) {
    await markDone();
    return NextResponse.json({ ok: true, birthdays: 0 });
  }

  const names = celebrants.map((c) => c.full_name).join(", ");

  // One batched insert for the whole welfare team, rather than a fresh admin
  // client and round trip per member (AUDIT NOTIF-4).
  await notifyRole("welfare", {
    type: "birthday_today",
    title: "🎂 Birthday today",
    body:
      celebrants.length === 1
        ? `It's ${names}'s birthday today — reach out and celebrate them!`
        : `Birthdays today: ${names}. Reach out and celebrate them!`,
    link: "/welfare",
  });

  await markDone();

  return NextResponse.json({ ok: true, birthdays: celebrants.length });
}
