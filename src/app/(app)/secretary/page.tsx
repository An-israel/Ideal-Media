import Link from "next/link";
import { ClipboardList, Users, ArrowRight, UploadCloud, CalendarClock, Table2 } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";

function HubCard({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: typeof Users;
  title: string;
  description: string;
}) {
  return (
    <Link href={href}>
      <Card className="h-full transition-colors hover:border-[var(--accent)]">
        <CardContent className="flex items-start gap-4 pt-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
            <Icon className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <p className="font-medium">{title}</p>
            <p className="text-sm text-[var(--text-muted)]">{description}</p>
          </div>
          <ArrowRight className="h-4 w-4 text-[var(--text-muted)]" />
        </CardContent>
      </Card>
    </Link>
  );
}

export default function SecretaryPage() {
  return (
    <div>
      <PageHeader title="Secretary" description="Attendance uploads and roster management." />
      <div className="grid gap-4 sm:grid-cols-2">
        <HubCard
          href="/secretary/attendance"
          icon={ClipboardList}
          title="Attendance"
          description="Upload a weekly sheet or photo, review the AI mapping, and commit."
        />
        <HubCard
          href="/secretary/attendance-records"
          icon={Table2}
          title="View attendance"
          description="See who attended each service, per member, with rates."
        />
        <HubCard
          href="/secretary/roster"
          icon={Users}
          title="Roster"
          description="Set member status (active, inactive, traveled, graduated, left)."
        />
        <HubCard
          href="/secretary/import-members"
          icon={UploadCloud}
          title="Import members"
          description="Add your whole team at once from a spreadsheet."
        />
        <HubCard
          href="/secretary/import-attendance"
          icon={CalendarClock}
          title="Import past attendance"
          description="Load historical attendance records in one go."
        />
      </div>
    </div>
  );
}

