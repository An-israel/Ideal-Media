import Link from "next/link";
import { ClipboardList, Users, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function SecretaryPage() {
  return (
    <div>
      <PageHeader title="Secretary" description="Attendance uploads and roster management." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/secretary/attendance">
          <Card className="h-full transition-colors hover:border-[var(--accent)]">
            <CardContent className="flex items-start gap-4 pt-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                <ClipboardList className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <p className="font-medium">Attendance</p>
                <p className="text-sm text-[var(--text-muted)]">
                  Upload a weekly sheet, review the AI mapping, and commit.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-[var(--text-muted)]" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/secretary/roster">
          <Card className="h-full transition-colors hover:border-[var(--accent)]">
            <CardContent className="flex items-start gap-4 pt-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                <Users className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <p className="font-medium">Roster</p>
                <p className="text-sm text-[var(--text-muted)]">
                  Set member status (active, inactive, traveled, graduated, left).
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-[var(--text-muted)]" />
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
