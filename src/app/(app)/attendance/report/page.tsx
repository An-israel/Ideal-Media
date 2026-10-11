import { notFound } from "next/navigation";
import { getSessionRoles } from "@/lib/auth";
import {
  getServiceActivities,
  getReportData,
  getUnassignedMembers,
} from "@/lib/attendance-queries";
import {
  weekServices,
  sundayOfWeek,
  currentWeekSunday,
} from "@/lib/attendance-window";
import { WeekPicker } from "../week-picker";
import { formatReportText, formatSubunitBreakdown } from "@/lib/attendance-report";
import { PageHeader } from "@/components/app/page-header";
import { ReportView } from "./report-view";

export default async function AttendanceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ activity?: string; date?: string; week?: string }>;
}) {
  const session = await getSessionRoles();
  if (!session) return null;
  const allowed =
    session.roles.includes("super_admin") ||
    session.roles.includes("secretary") ||
    session.roles.includes("welfare");
  if (!allowed) notFound();

  const { sunday, bibleStudy } = await getServiceActivities();

  const params = await searchParams;
  const thisWeek = currentWeekSunday();
  const weekSunday = /^\d{4}-\d{2}-\d{2}$/.test(params.week ?? "")
    ? sundayOfWeek(params.week!)
    : params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? sundayOfWeek(params.date)
      : thisWeek;
  const dates = weekServices(weekSunday);

  const services = [
    sunday ? { id: sunday.id, name: "Sunday Service", date: dates.sunday } : null,
    bibleStudy ? { id: bibleStudy.id, name: "Bible Study", date: dates.wednesday } : null,
  ].filter(Boolean) as { id: string; name: string; date: string }[];

  const activityId = params.activity ?? services[0]?.id;
  const serviceDate = params.date ?? services.find((s) => s.id === activityId)?.date;

  if (!activityId || !serviceDate) {
    return (
      <div>
        <PageHeader title="Department report" description="No services are configured yet." />
      </div>
    );
  }

  const [report, unassigned] = await Promise.all([
    getReportData(activityId, serviceDate),
    getUnassignedMembers(),
  ]);

  return (
    <div>
      <PageHeader
        title="Department report"
        description="Generated from what has been recorded. Copy it straight into the Pastors' chat."
      />
      <WeekPicker
        basePath="/attendance/report"
        weekSunday={weekSunday}
        currentWeek={thisWeek}
        label={weekSunday === thisWeek ? "This week" : `Week of ${weekSunday}`}
      />
      <ReportView
        services={services}
        activityId={activityId}
        serviceDate={serviceDate}
        reportText={formatReportText(report)}
        breakdownText={formatSubunitBreakdown(report)}
        missingSubunits={report.missingSubunits}
        unassigned={unassigned.map((u) => u.fullName)}
        totals={{
          total: report.totalMembers,
          present: report.present,
          absent: report.absent,
          onIt: report.onIt,
        }}
        subunits={report.subunits}
      />
    </div>
  );
}
