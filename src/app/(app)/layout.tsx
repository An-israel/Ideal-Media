import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionRoles } from "@/lib/auth";
import { AppShell } from "@/components/app/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionRoles();
  if (!session) redirect("/login");
  if (!session.cocCompleted) redirect("/coc");

  const supabase = await createClient();
  const [{ data: profile }, { count }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", session.userId).single(),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("is_read", false),
  ]);

  return (
    <AppShell
      roles={session.roles}
      fullName={profile?.full_name ?? "Member"}
      unreadCount={count ?? 0}
    >
      {children}
    </AppShell>
  );
}
