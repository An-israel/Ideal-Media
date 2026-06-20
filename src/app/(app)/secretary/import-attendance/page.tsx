import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImportAttendanceForm } from "./import-attendance-form";

export default async function ImportAttendancePage() {
  const supabase = await createClient();
  const { data: activities } = await supabase.from("activities").select("id, name").order("name");

  return (
    <div>
      <PageHeader
        title="Import past attendance"
        description="Load your historical attendance records in one go."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <ImportAttendanceForm activities={activities ?? []} />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How to prepare your file</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-[var(--text-muted)]">
            <p>Pick the activity above, then upload a .xlsx/.csv with a header row and one row per record:</p>
            <ul className="space-y-1">
              <li>• <b>Email</b> (or <b>Name</b>) — who the record is for</li>
              <li>• <b>Date</b> — best as 2025-01-05 (or a real Excel date)</li>
              <li>• <b>Status</b> — present / absent / traveled / excused</li>
            </ul>
            <p>
              Members are matched by email first, then by name. Import your members
              first if they are not in the system yet. Rows that do not match are
              listed so you can fix them.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
