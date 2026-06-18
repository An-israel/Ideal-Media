import { createAdminClient } from "@/lib/supabase/admin";
import { ActivitiesClient } from "./activities-client";
import { DEFAULT_MISSED_SERVICE_THRESHOLD } from "@/lib/constants";

export default async function ActivitiesPage() {
  const admin = createAdminClient();
  const [{ data: activities }, { data: setting }] = await Promise.all([
    admin.from("activities").select("id, name, day_of_week, time_of_day, is_attendance_signal").order("name"),
    admin.from("app_settings").select("value").eq("key", "missed_service_threshold").maybeSingle(),
  ]);

  return (
    <ActivitiesClient
      activities={activities ?? []}
      threshold={Number(setting?.value ?? DEFAULT_MISSED_SERVICE_THRESHOLD)}
    />
  );
}
