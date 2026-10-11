import { notFound } from "next/navigation";
import { getSessionRoles } from "@/lib/auth";
import { getServiceActivities } from "@/lib/attendance-queries";
import {
  weekServices,
  sundayOfWeek,
  currentWeekSunday,
  hasOccurred,
} from "@/lib/attendance-window";
import { WeekPicker } from "../week-picker";
import { PageHeader } from "@/components/app/page-header";
import { PasteFlow } from "./paste-flow";

export default async function PasteAbsenteesPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const session = await getSessionRoles();
  if (!session) return null;
  const allowed =
    session.roles.includes("super_admin") ||
    session.roles.includes("secretary") ||
    session.roles.includes("welfare");
  if (!allowed) notFound();

  const { sunday, bibleStudy } = await getServiceActivities();

  const { week } = await searchParams;
  const thisWeek = currentWeekSunday();
  const weekSunday = /^\d{4}-\d{2}-\d{2}$/.test(week ?? "")
    ? sundayOfWeek(week!)
    : thisWeek;
  const dates = weekServices(weekSunday);

  const services = (
    [
      sunday ? { id: sunday.id, name: "Sunday Service", date: dates.sunday } : null,
      bibleStudy ? { id: bibleStudy.id, name: "Bible Study", date: dates.wednesday } : null,
    ].filter(Boolean) as { id: string; name: string; date: string }[]
  ).filter((s) => hasOccurred(s.date));

  return (
    <div>
      <PageHeader
        title="Paste an absentee list"
        description="Paste the report you already write each week. Everyone named is marked absent under their heading; everyone else on the roll is marked present."
      />
      <WeekPicker
        basePath="/attendance/paste"
        weekSunday={weekSunday}
        currentWeek={thisWeek}
        label={weekSunday === thisWeek ? "This week" : `Week of ${weekSunday}`}
      />
      {services.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] px-4 py-6 text-sm text-[var(--text-muted)]">
          Neither service in this week has been held yet. Step back a week to report one that has.
        </p>
      ) : (
        <PasteFlow services={services} />
      )}
    </div>
  );
}
