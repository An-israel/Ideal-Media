import Link from "next/link";
import { GraduationCap, ClipboardCheck, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function LeaderPage() {
  const supabase = await createClient();

  // RLS scopes these to the subunits this user leads.
  const [{ count: submissions }, { count: applications }] = await Promise.all([
    supabase
      .from("module_progress")
      .select("id", { count: "exact", head: true })
      .eq("status", "submitted"),
    supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending_application"),
  ]);

  const pending = (submissions ?? 0) + (applications ?? 0);

  return (
    <div>
      <PageHeader
        title="Leader"
        description="Build courses and work through your approvals queue."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/leader/courses">
          <Card className="h-full transition-colors hover:border-[var(--accent)]">
            <CardContent className="flex items-start gap-4 pt-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                <GraduationCap className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <p className="font-medium">Courses</p>
                <p className="text-sm text-[var(--text-muted)]">
                  Create modules, assignments, and publish.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-[var(--text-muted)]" />
            </CardContent>
          </Card>
        </Link>

        <Link href="/leader/approvals">
          <Card className="h-full transition-colors hover:border-[var(--accent)]">
            <CardContent className="flex items-start gap-4 pt-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                <ClipboardCheck className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <p className="flex items-center gap-2 font-medium">
                  Approvals
                  {pending > 0 && <Badge variant="warning">{pending} pending</Badge>}
                </p>
                <p className="text-sm text-[var(--text-muted)]">
                  Review assignment submissions and course applications.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-[var(--text-muted)]" />
            </CardContent>
          </Card>
        </Link>
      </div>

      <p className="mt-6 text-sm text-[var(--text-muted)]">
        Members, attendance view, and per-member performance arrive in Phase 4.
      </p>
    </div>
  );
}
