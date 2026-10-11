import { notFound } from "next/navigation";
import { getSessionRoles } from "@/lib/auth";
import { getServiceActivities } from "@/lib/attendance-queries";
import { openServiceDates } from "@/lib/attendance-window";
import { PageHeader } from "@/components/app/page-header";
import { PasteFlow } from "./paste-flow";

export default async function PasteAbsenteesPage() {
  const session = await getSessionRoles();
  if (!session) return null;
  const allowed =
    session.roles.includes("super_admin") ||
    session.roles.includes("secretary") ||
    session.roles.includes("welfare");
  if (!allowed) notFound();

  const { sunday, bibleStudy } = await getServiceActivities();
  const dates = openServiceDates();

  const services = [
    sunday ? { id: sunday.id, name: "Sunday Service", date: dates.sunday } : null,
    bibleStudy ? { id: bibleStudy.id, name: "Bible Study", date: dates.wednesday } : null,
  ].filter(Boolean) as { id: string; name: string; date: string }[];

  return (
    <div>
      <PageHeader
        title="Paste an absentee list"
        description="Paste the report you already write each week. Everyone named is marked absent under their heading; everyone else on the roll is marked present."
      />
      <PasteFlow services={services} />
    </div>
  );
}
