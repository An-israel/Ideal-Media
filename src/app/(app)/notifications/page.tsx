import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Bell } from "lucide-react";
import { MarkRead } from "./mark-read";

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: notifications } = await supabase
    .from("notifications")
    .select("id, title, body, link, is_read, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = notifications ?? [];
  const hasUnread = rows.some((n) => !n.is_read);

  return (
    <div>
      <MarkRead hasUnread={hasUnread} />
      <PageHeader title="Notifications" />
      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Bell className="h-8 w-8 text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">You&apos;re all caught up.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((n) => (
            <Card key={n.id}>
              <CardContent className="flex items-start gap-3 p-4">
                <span
                  className={
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full " +
                    (n.is_read ? "bg-[var(--border)]" : "bg-[var(--accent)]")
                  }
                />
                <div>
                  <p className="text-sm font-medium">{n.title}</p>
                  {n.body && <p className="text-sm text-[var(--text-muted)]">{n.body}</p>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
