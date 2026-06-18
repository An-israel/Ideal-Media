"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { COC_PASS_THRESHOLD, COC_QUIZ_SIZE } from "@/lib/constants";
import { shuffle } from "@/lib/utils";

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[]; // original order; client reshuffles for display
}

/**
 * Returns a random subset of active questions WITHOUT the correct answers
 * (Section 6). Read with the admin client so coc_questions stays locked down
 * by RLS — the correct_option_index never leaves the server.
 */
export async function getQuizQuestions(): Promise<QuizQuestion[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("coc_questions")
    .select("id, question, options")
    .eq("is_active", true);

  const picked = shuffle(data ?? []).slice(0, COC_QUIZ_SIZE);
  return picked.map((q) => ({
    id: q.id,
    question: q.question,
    options: q.options as string[],
  }));
}

export interface GradeResult {
  passed: boolean;
  score: number;
  total: number;
}

/** Grades the quiz server-side, records the attempt, unlocks on pass. */
export async function gradeQuiz(
  answers: { questionId: string; selectedIndex: number }[]
): Promise<GradeResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const admin = createAdminClient();
  const ids = answers.map((a) => a.questionId);
  const { data: questions } = await admin
    .from("coc_questions")
    .select("id, correct_option_index")
    .in("id", ids);

  const correctById = new Map(
    (questions ?? []).map((q) => [q.id, q.correct_option_index])
  );

  const total = answers.length;
  let score = 0;
  for (const a of answers) {
    if (correctById.get(a.questionId) === a.selectedIndex) score++;
  }
  const passed = total > 0 && score / total >= COC_PASS_THRESHOLD;

  await admin.from("coc_attempts").insert({
    user_id: user.id,
    passed,
    score,
    total,
  });

  if (passed) {
    await admin
      .from("profiles")
      .update({ coc_completed: true, coc_completed_at: new Date().toISOString() })
      .eq("id", user.id);
  }

  return { passed, score, total };
}
