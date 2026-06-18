import { createAdminClient } from "@/lib/supabase/admin";
import { CocClient, type QuestionRow } from "./coc-client";

export default async function AdminCocPage() {
  const admin = createAdminClient();
  const [{ data: coc }, { data: questions }] = await Promise.all([
    admin.from("code_of_conduct").select("title, body, version").eq("is_active", true).maybeSingle(),
    admin.from("coc_questions").select("id, question, options, correct_option_index, is_active").order("created_at"),
  ]);

  const rows: QuestionRow[] = (questions ?? []).map((q) => ({
    id: q.id,
    question: q.question,
    options: q.options as string[],
    correctIndex: q.correct_option_index,
    isActive: q.is_active,
  }));

  return (
    <CocClient
      title={coc?.title ?? "Code of Conduct"}
      body={coc?.body ?? ""}
      version={coc?.version ?? 0}
      questions={rows}
    />
  );
}
