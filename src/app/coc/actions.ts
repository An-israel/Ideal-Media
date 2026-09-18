"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  COC_PASS_THRESHOLD,
  COC_QUIZ_SIZE,
  COC_MAX_ATTEMPTS_PER_WINDOW,
  COC_ATTEMPT_WINDOW_MINUTES,
} from "@/lib/constants";
import { shuffle } from "@/lib/utils";

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[]; // original order; client reshuffles for display
}

export interface IssuedQuiz {
  /** Identifies this specific issued quiz; must be passed back to gradeQuiz. */
  issueId: string;
  questions: QuizQuestion[];
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user;
}

/**
 * Issues a quiz: picks a random subset of active questions, records which ones
 * were issued, and returns them WITHOUT the correct answers (Section 6).
 *
 * The issued set is persisted (AUDIT SEC-4). Grading previously trusted the
 * client's array and derived the total from it, so submitting a single correct
 * answer scored 1/1 and passed the gate. The server now owns both the question
 * set and the denominator.
 */
export async function getQuizQuestions(): Promise<IssuedQuiz> {
  const user = await requireUser();
  const admin = createAdminClient();

  const { data } = await admin
    .from("coc_questions")
    .select("id, question, options")
    .eq("is_active", true);

  const pool = data ?? [];
  if (pool.length === 0) throw new Error("No code-of-conduct questions are configured yet.");

  const picked = shuffle(pool).slice(0, Math.min(COC_QUIZ_SIZE, pool.length));

  // Void any quiz previously issued to this user so only the newest is
  // gradeable — otherwise a member could hold several open issues and
  // cherry-pick the one they answered correctly.
  await admin
    .from("coc_quiz_issues")
    .update({ consumed: true })
    .eq("user_id", user.id)
    .eq("consumed", false);

  const { data: issue, error } = await admin
    .from("coc_quiz_issues")
    .insert({ user_id: user.id, question_ids: picked.map((q) => q.id) })
    .select("id")
    .single();
  if (error || !issue) throw new Error("Could not start the quiz. Please try again.");

  return {
    issueId: issue.id,
    questions: picked.map((q) => ({
      id: q.id,
      question: q.question,
      options: q.options as string[],
    })),
  };
}

export interface GradeResult {
  passed: boolean;
  score: number;
  total: number;
  /** Set when the attempt was refused rather than graded. */
  error?: string;
}

/**
 * Grades the quiz server-side against the issued question set, records the
 * attempt, and unlocks the gate on a pass.
 *
 * The denominator is the number of questions the server issued — not the
 * number of answers the client sent — so omitting the questions you don't know
 * scores them wrong instead of shrinking the total.
 */
export async function gradeQuiz(
  issueId: string,
  answers: { questionId: string; selectedIndex: number }[]
): Promise<GradeResult> {
  const user = await requireUser();
  const admin = createAdminClient();

  // Rate limit (AUDIT AUTH-5): the quiz is 100%-to-pass with reshuffled
  // options, so unlimited retries are themselves a bypass.
  const windowStart = new Date(Date.now() - COC_ATTEMPT_WINDOW_MINUTES * 60_000).toISOString();
  const { count: recentAttempts } = await admin
    .from("coc_attempts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("attempted_at", windowStart);

  if ((recentAttempts ?? 0) >= COC_MAX_ATTEMPTS_PER_WINDOW) {
    return {
      passed: false,
      score: 0,
      total: 0,
      error: `Too many attempts. Please re-read the code of conduct and try again in ${COC_ATTEMPT_WINDOW_MINUTES} minutes.`,
    };
  }

  // Claim the issued quiz. The `consumed` guard makes this single-use, so the
  // same issue cannot be replayed with different answers.
  const { data: issue } = await admin
    .from("coc_quiz_issues")
    .update({ consumed: true })
    .eq("id", issueId)
    .eq("user_id", user.id)
    .eq("consumed", false)
    .select("question_ids")
    .maybeSingle();

  if (!issue) {
    return {
      passed: false,
      score: 0,
      total: 0,
      error: "That quiz has expired or was already submitted. Please start a new one.",
    };
  }

  const issuedIds: string[] = issue.question_ids;
  const total = issuedIds.length;

  const { data: questions } = await admin
    .from("coc_questions")
    .select("id, correct_option_index")
    .in("id", issuedIds);

  const correctById = new Map((questions ?? []).map((q) => [q.id, q.correct_option_index]));

  // Only the first answer per question counts, and only for issued questions —
  // so repeating a question you know cannot inflate the score.
  const submitted = new Map<string, number>();
  for (const a of answers) {
    if (!submitted.has(a.questionId)) submitted.set(a.questionId, a.selectedIndex);
  }

  let score = 0;
  for (const id of issuedIds) {
    if (submitted.get(id) === correctById.get(id)) score++;
  }

  const passed = total > 0 && score / total >= COC_PASS_THRESHOLD;

  const { data: activeCoc } = await admin
    .from("code_of_conduct")
    .select("version")
    .eq("is_active", true)
    .maybeSingle();

  await admin.from("coc_attempts").insert({
    user_id: user.id,
    passed,
    score,
    total,
    coc_version: activeCoc?.version ?? null,
  });

  if (passed) {
    // Record which version was accepted so publishing a revision can require
    // re-acceptance (AUDIT AUTH-3).
    await admin
      .from("profiles")
      .update({
        coc_completed: true,
        coc_completed_at: new Date().toISOString(),
        coc_version_accepted: activeCoc?.version ?? null,
      })
      .eq("id", user.id);
  }

  return { passed, score, total };
}
