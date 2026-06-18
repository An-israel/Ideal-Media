import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { CocFlow } from "./coc-flow";

export default async function CocPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("coc_completed")
    .eq("id", user.id)
    .single();
  if (profile?.coc_completed) redirect("/dashboard");

  const { data: coc } = await supabase
    .from("code_of_conduct")
    .select("title, body")
    .eq("is_active", true)
    .single();

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)]">
      <header className="flex items-center justify-between border-b border-[var(--border)] p-6">
        <Wordmark />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 justify-center p-4">
        <div className="w-full max-w-2xl py-6">
          <CocFlow title={coc?.title ?? "Code of Conduct"} body={coc?.body ?? ""} />
        </div>
      </main>
    </div>
  );
}
