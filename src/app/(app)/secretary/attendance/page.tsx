import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UploadForm } from "./upload-form";
import { ReopenButton } from "./reopen-button";
import type { UploadStatus } from "@/lib/database.types";

const STATUS_VARIANT: Record<UploadStatus, "neutral" | "warning" | "success" | "danger"> = {
  parsing: "warning",
  needs_review: "warning",
  committed: "success",
  discarded: "neutral",
};

export default async function AttendancePage() {
  const supabase = await createClient();

  const [{ data: activities }, { data: uploads }] = await Promise.all([
    supabase.from("activities").select("id, name").order("name"),
    supabase
      .from("attendance_uploads")
      .select("id, original_filename, service_date, status, parse_error, activities(name)")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  type Row = {
    id: string;
    original_filename: string;
    service_date: string;
    status: UploadStatus;
    parse_error: string | null;
    activities: { name: string } | null;
  };
  const rows = (uploads ?? []) as unknown as Row[];

  return (
    <div>
      <PageHeader title="Attendance" description="Upload a sheet, review the mapping, then commit." />

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <UploadForm activities={activities ?? []} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent uploads</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-[var(--text-muted)]">No uploads yet.</p>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {rows.map((u) => {
                  const inner = (
                    <div className="flex items-center justify-between gap-3 px-5 py-3.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{u.original_filename}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {u.activities?.name} · {u.service_date}
                        </p>
                        {u.parse_error && u.status !== "committed" && (
                          <p className="mt-0.5 text-xs text-[var(--danger)]">
                            Needs manual mapping — couldn&apos;t be read automatically
                          </p>
                        )}
                      </div>
                      <Badge variant={STATUS_VARIANT[u.status]}>{u.status.replace("_", " ")}</Badge>
                    </div>
                  );

                  if (u.status === "needs_review") {
                    return (
                      <Link
                        key={u.id}
                        href={`/secretary/attendance/${u.id}`}
                        className="block transition-colors hover:bg-[var(--bg)]"
                      >
                        {inner}
                      </Link>
                    );
                  }

                  // A committed upload can be reopened to correct a mistake.
                  if (u.status === "committed") {
                    return (
                      <div key={u.id} className="flex items-center justify-between gap-2 pr-4">
                        <div className="min-w-0 flex-1">{inner}</div>
                        <ReopenButton uploadId={u.id} label={u.original_filename} />
                      </div>
                    );
                  }

                  return <div key={u.id}>{inner}</div>;
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
