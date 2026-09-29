import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TeachingMediaType } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/pagination";
import { TRAINING_SIGNED_URL_SECONDS } from "@/lib/constants";
import { listenPercent } from "@/lib/training-progress";

type DB = SupabaseClient<Database>;

export interface TeachingListItem {
  id: string;
  seriesId: string;
  seriesTitle: string;
  position: number;
  title: string;
  description: string | null;
  mediaType: TeachingMediaType;
  durationSeconds: number | null;
  isPublished: boolean;
  /** The signed-in member's own progress, when they have any. */
  listenedSeconds: number;
  furthestSeconds: number;
  percent: number;
  completed: boolean;
  completedManually: boolean;
}

export interface SeriesWithTeachings {
  id: string;
  title: string;
  description: string | null;
  position: number;
  isPublished: boolean;
  teachings: TeachingListItem[];
  /** How many of this series' teachings the member has completed. */
  completedCount: number;
}

// The listen-tracking maths lives in lib/training-progress.ts (no server-only)
// so it can be unit tested. Re-exported so existing imports keep working.
export {
  listenPercent,
  qualifiesAsListened,
  clampPlayedIncrement,
} from "@/lib/training-progress";

/**
 * The training library as one member sees it: published series and teachings,
 * with that member's own progress attached.
 *
 * `includeUnpublished` is for the manage screen — RLS already restricts drafts
 * to training managers, so a member asking for them simply gets nothing extra.
 */
export async function getTrainingForMember(
  supabase: DB,
  userId: string,
  opts?: { includeUnpublished?: boolean }
): Promise<SeriesWithTeachings[]> {
  const seriesQuery = supabase
    .from("training_series")
    .select("id, title, description, position, is_published")
    .order("position", { ascending: true });
  if (!opts?.includeUnpublished) seriesQuery.eq("is_published", true);
  const { data: series, error: seriesErr } = await seriesQuery;
  if (seriesErr) throw new Error(seriesErr.message);
  if (!series || series.length === 0) return [];

  const seriesIds = series.map((s) => s.id);

  const teachingsQuery = supabase
    .from("training_teachings")
    .select(
      "id, series_id, position, title, description, media_type, duration_seconds, is_published"
    )
    .in("series_id", seriesIds)
    .order("position", { ascending: true });
  if (!opts?.includeUnpublished) teachingsQuery.eq("is_published", true);
  const { data: teachings, error: teachErr } = await teachingsQuery;
  if (teachErr) throw new Error(teachErr.message);

  const teachingIds = (teachings ?? []).map((t) => t.id);
  const progressRows = teachingIds.length
    ? await fetchAllRows<{
        teaching_id: string;
        listened_seconds: number;
        furthest_seconds: number;
        completed: boolean;
        completion_source: string | null;
      }>((from, to) =>
        supabase
          .from("teaching_progress")
          .select("teaching_id, listened_seconds, furthest_seconds, completed, completion_source")
          .eq("user_id", userId)
          .in("teaching_id", teachingIds)
          .range(from, to)
      )
    : [];
  const progressByTeaching = new Map(progressRows.map((p) => [p.teaching_id, p]));

  const titleById = new Map(series.map((s) => [s.id, s.title]));

  const items: TeachingListItem[] = (teachings ?? []).map((t) => {
    const p = progressByTeaching.get(t.id);
    const listened = p?.listened_seconds ?? 0;
    const completed = p?.completed ?? false;
    return {
      id: t.id,
      seriesId: t.series_id,
      seriesTitle: titleById.get(t.series_id) ?? "",
      position: t.position,
      title: t.title,
      description: t.description,
      mediaType: t.media_type,
      durationSeconds: t.duration_seconds,
      isPublished: t.is_published,
      listenedSeconds: listened,
      furthestSeconds: p?.furthest_seconds ?? 0,
      percent: listenPercent(listened, t.duration_seconds, completed),
      completed,
      completedManually: p?.completion_source === "manual",
    };
  });

  return series.map((s) => {
    const own = items.filter((t) => t.seriesId === s.id);
    return {
      id: s.id,
      title: s.title,
      description: s.description,
      position: s.position,
      isPublished: s.is_published,
      teachings: own,
      completedCount: own.filter((t) => t.completed).length,
    };
  });
}

/**
 * A short-lived signed URL for an uploaded teaching.
 *
 * The bucket is private, so media is never publicly listable — the URL is
 * minted per page view and expires. Uses the admin client because a member's
 * own token has no storage grant beyond the read policy, and the link has to
 * work in an <audio>/<video> element without auth headers.
 */
export async function getTeachingMediaUrl(storagePath: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from("training")
    .createSignedUrl(storagePath, TRAINING_SIGNED_URL_SECONDS);
  if (error) {
    console.error(`[training] could not sign ${storagePath}:`, error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

// ---------------------------------------------------------------- reporting --

export interface TeachingReportRow {
  teachingId: string;
  seriesTitle: string;
  position: number;
  title: string;
  durationSeconds: number | null;
  isPublished: boolean;
  /** Members who have genuinely been through it. */
  listened: number;
  /** Members who started but haven't finished. */
  started: number;
  /** Members who have never opened it. */
  notStarted: number;
  /** Of `listened`, how many ticked it manually rather than playing it through. */
  manualCompletions: number;
  eligible: number;
}

export interface MemberReportRow {
  userId: string;
  fullName: string;
  primarySubunit: string | null;
  completed: number;
  started: number;
  /** Percent of published teachings this member has completed. */
  percent: number;
}

export interface TrainingReport {
  totalTeachings: number;
  eligibleMembers: number;
  /** Members who have completed every published teaching. */
  fullyCaughtUp: number;
  /** Members who have not completed a single teaching. */
  noneStarted: number;
  perTeaching: TeachingReportRow[];
  perMember: MemberReportRow[];
}

/**
 * The listen report: for every teaching, who has been through it and who
 * hasn't; and for every member, how far through the library they are.
 *
 * Runs on the admin client because it has to see all members and all progress,
 * which no single caller's RLS scope covers. **Callers must authorise first** —
 * see requireTrainingReportAccess in the training actions.
 *
 * `subunitIds` narrows the member list, so a subunit leader gets a report about
 * their own people rather than the whole department.
 */
export async function getTrainingReport(opts?: {
  subunitIds?: string[];
}): Promise<TrainingReport> {
  const admin = createAdminClient();

  const [series, teachings] = await Promise.all([
    fetchAllRows<{ id: string; title: string; position: number }>((from, to) =>
      admin.from("training_series").select("id, title, position").range(from, to)
    ),
    fetchAllRows<{
      id: string;
      series_id: string;
      position: number;
      title: string;
      duration_seconds: number | null;
      is_published: boolean;
    }>((from, to) =>
      admin
        .from("training_teachings")
        .select("id, series_id, position, title, duration_seconds, is_published")
        .order("position", { ascending: true })
        .range(from, to)
    ),
  ]);

  const seriesTitle = new Map(series.map((s) => [s.id, s.title]));

  // Eligible = active members who can actually log in and listen. Unclaimed
  // imported records would otherwise drag every percentage down for no reason.
  const eligibleProfiles = await fetchAllRows<{
    id: string;
    full_name: string;
    member_status: string;
    claimed: boolean;
  }>((from, to) =>
    admin
      .from("profiles")
      .select("id, full_name, member_status, claimed")
      .eq("member_status", "active")
      .eq("claimed", true)
      .order("full_name", { ascending: true })
      .range(from, to)
  );

  type MembershipRow = {
    user_id: string;
    subunit_id: string;
    membership_type: string;
    subunits: { name: string } | null;
  };
  // Cast: embeds aren't modelled in our hand-maintained types (Relationships: []).
  const memberships = await fetchAllRows<MembershipRow>((from, to) =>
    admin
      .from("subunit_members")
      .select("user_id, subunit_id, membership_type, subunits(name)")
      .range(from, to) as unknown as PromiseLike<{
      data: MembershipRow[] | null;
      error: { message: string } | null;
    }>
  );

  const primaryByUser = new Map<string, { id: string; name: string | null }>();
  const subunitIdsByUser = new Map<string, Set<string>>();
  for (const m of memberships) {
    const set = subunitIdsByUser.get(m.user_id) ?? new Set<string>();
    set.add(m.subunit_id);
    subunitIdsByUser.set(m.user_id, set);
    if (m.membership_type === "primary") {
      primaryByUser.set(m.user_id, { id: m.subunit_id, name: m.subunits?.name ?? null });
    }
  }

  const scoped = opts?.subunitIds?.length
    ? eligibleProfiles.filter((p) => {
        const ids = subunitIdsByUser.get(p.id);
        return ids ? opts.subunitIds!.some((s) => ids.has(s)) : false;
      })
    : eligibleProfiles;

  const memberIds = new Set(scoped.map((p) => p.id));

  const progress = await fetchAllRows<{
    user_id: string;
    teaching_id: string;
    listened_seconds: number;
    completed: boolean;
    completion_source: string | null;
  }>((from, to) =>
    admin
      .from("teaching_progress")
      .select("user_id, teaching_id, listened_seconds, completed, completion_source")
      .range(from, to)
  );
  const relevant = progress.filter((p) => memberIds.has(p.user_id));

  const publishedTeachings = teachings.filter((t) => t.is_published);

  const perTeaching: TeachingReportRow[] = teachings.map((t) => {
    const rows = relevant.filter((p) => p.teaching_id === t.id);
    const listened = rows.filter((p) => p.completed).length;
    const started = rows.filter((p) => !p.completed && p.listened_seconds > 0).length;
    return {
      teachingId: t.id,
      seriesTitle: seriesTitle.get(t.series_id) ?? "",
      position: t.position,
      title: t.title,
      durationSeconds: t.duration_seconds,
      isPublished: t.is_published,
      listened,
      started,
      notStarted: Math.max(0, scoped.length - listened - started),
      manualCompletions: rows.filter((p) => p.completed && p.completion_source === "manual").length,
      eligible: scoped.length,
    };
  });

  const publishedIds = new Set(publishedTeachings.map((t) => t.id));
  const perMember: MemberReportRow[] = scoped.map((p) => {
    const rows = relevant.filter((r) => r.user_id === p.id && publishedIds.has(r.teaching_id));
    const completed = rows.filter((r) => r.completed).length;
    return {
      userId: p.id,
      fullName: p.full_name,
      primarySubunit: primaryByUser.get(p.id)?.name ?? null,
      completed,
      started: rows.filter((r) => !r.completed && r.listened_seconds > 0).length,
      percent: publishedIds.size
        ? Math.round((completed / publishedIds.size) * 100)
        : 0,
    };
  });
  perMember.sort((a, b) => b.percent - a.percent || a.fullName.localeCompare(b.fullName));

  return {
    totalTeachings: publishedIds.size,
    eligibleMembers: scoped.length,
    fullyCaughtUp: publishedIds.size
      ? perMember.filter((m) => m.completed === publishedIds.size).length
      : 0,
    noneStarted: perMember.filter((m) => m.completed === 0 && m.started === 0).length,
    perTeaching,
    perMember,
  };
}
