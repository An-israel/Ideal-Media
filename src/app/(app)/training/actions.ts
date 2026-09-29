"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionRoles, type SessionRoles } from "@/lib/auth";
import { qualifiesAsListened, clampPlayedIncrement } from "@/lib/training-progress";
import type { TeachingCompletionSource } from "@/lib/database.types";

async function requireUser(): Promise<SessionRoles> {
  const session = await getSessionRoles();
  if (!session) throw new Error("Not authenticated");
  return session;
}

/** Super admin or secretary may add, edit and publish teachings. */
export async function requireTrainingManager(): Promise<SessionRoles> {
  const session = await requireUser();
  if (!session.roles.includes("super_admin") && !session.roles.includes("secretary")) {
    throw new Error("Only a super admin or secretary can manage the training library.");
  }
  return session;
}

/**
 * Who may see the listen report, and over which members.
 *
 * Super admins and secretaries see the whole department. A subunit leader sees
 * only their own subunits' members — which is what `subunitIds` narrows.
 */
export async function requireTrainingReportAccess(): Promise<{
  session: SessionRoles;
  subunitIds?: string[];
}> {
  const session = await requireUser();
  if (session.roles.includes("super_admin") || session.roles.includes("secretary")) {
    return { session };
  }
  if (session.ledSubunitIds.length > 0) {
    return { session, subunitIds: session.ledSubunitIds };
  }
  throw new Error("You don't have access to the training report.");
}

export interface ProgressUpdate {
  teachingId: string;
  /** Seconds of real playback since the last report. Clamped server-side. */
  playedSeconds: number;
  /** Current playhead position, for resuming. */
  positionSeconds: number;
  /** Media duration as the player measured it, if we don't have it yet. */
  durationSeconds?: number;
}

export interface ProgressResult {
  listenedSeconds: number;
  completed: boolean;
  percent: number;
}

/**
 * Records real playback progress and auto-completes the teaching once enough
 * of it has genuinely been played.
 *
 * `playedSeconds` is an INCREMENT of actual play time, not a position, and it
 * is clamped to the reporting interval — so a client cannot claim it played an
 * hour in one 15-second tick, and seeking to the end doesn't count as
 * listening. That is what makes "has listened" mean something.
 */
export async function reportProgress(update: ProgressUpdate): Promise<ProgressResult> {
  const session = await requireUser();
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: teaching } = await admin
    .from("training_teachings")
    .select("id, duration_seconds, is_published, series_id")
    .eq("id", update.teachingId)
    .maybeSingle();
  if (!teaching) throw new Error("Teaching not found.");

  // Learn the duration from the first player that reports one, so the
  // percentage has a denominator without the admin typing one in.
  let duration = teaching.duration_seconds;
  if (!duration && update.durationSeconds && update.durationSeconds > 0) {
    duration = Math.round(update.durationSeconds);
    await admin
      .from("training_teachings")
      .update({ duration_seconds: duration })
      .eq("id", teaching.id);
  }

  const { data: existing } = await supabase
    .from("teaching_progress")
    .select("id, listened_seconds, furthest_seconds, completed, completion_source")
    .eq("user_id", session.userId)
    .eq("teaching_id", teaching.id)
    .maybeSingle();

  // Trust only a plausible increment. The client reports every ~15s; allow a
  // little slack for a slow round trip, and never a negative.
  const increment = clampPlayedIncrement(update.playedSeconds);

  const listened = (existing?.listened_seconds ?? 0) + increment;
  const furthest = Math.max(
    existing?.furthest_seconds ?? 0,
    Math.max(0, Math.round(update.positionSeconds || 0))
  );

  const alreadyComplete = existing?.completed ?? false;
  const nowComplete = alreadyComplete || qualifiesAsListened(listened, duration);
  // Don't downgrade a manual tick to 'playback' if they later play it through.
  const source: TeachingCompletionSource | null = alreadyComplete
    ? (existing?.completion_source as TeachingCompletionSource | null)
    : nowComplete
    ? "playback"
    : null;

  const now = new Date().toISOString();
  const row = {
    user_id: session.userId,
    teaching_id: teaching.id,
    listened_seconds: listened,
    furthest_seconds: furthest,
    completed: nowComplete,
    completed_at: nowComplete ? (alreadyComplete ? undefined : now) : null,
    completion_source: source,
    last_activity_at: now,
  };

  if (existing) {
    const { error } = await supabase
      .from("teaching_progress")
      .update(row)
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("teaching_progress")
      .insert({ ...row, first_opened_at: now });
    if (error) throw new Error(error.message);
  }

  return {
    listenedSeconds: listened,
    completed: nowComplete,
    percent: duration ? Math.min(100, Math.round((listened / duration) * 100)) : 0,
  };
}

/**
 * Manual "I've listened to this" tick, for someone who listened elsewhere
 * (downloaded the file, heard it in a meeting).
 *
 * Recorded with `completion_source = 'manual'` so the report can tell a genuine
 * playthrough from a self-declaration — they are counted separately.
 */
export async function markTeachingListened(teachingId: string, listened: boolean) {
  const session = await requireUser();
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("teaching_progress")
    .select("id, completion_source")
    .eq("user_id", session.userId)
    .eq("teaching_id", teachingId)
    .maybeSingle();

  const now = new Date().toISOString();

  if (!listened) {
    // Un-ticking only clears a MANUAL completion. A real playthrough is a
    // measurement, not an opinion, so it stands.
    if (!existing) return;
    if (existing.completion_source !== "manual") {
      throw new Error(
        "This teaching was completed by playing it through, so it can't be un-marked."
      );
    }
    const { error } = await supabase
      .from("teaching_progress")
      .update({ completed: false, completed_at: null, completion_source: null })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else if (existing) {
    const { error } = await supabase
      .from("teaching_progress")
      .update({
        completed: true,
        completed_at: now,
        // Keep 'playback' if they'd already earned it properly.
        completion_source: existing.completion_source ?? "manual",
        last_activity_at: now,
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("teaching_progress").insert({
      user_id: session.userId,
      teaching_id: teachingId,
      completed: true,
      completed_at: now,
      completion_source: "manual",
      first_opened_at: now,
      last_activity_at: now,
    });
    if (error) throw new Error(error.message);
  }

  revalidatePath("/training");
  revalidatePath(`/training/${teachingId}`);
  revalidatePath("/dashboard");
}
