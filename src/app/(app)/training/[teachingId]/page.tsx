import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSessionRoles } from "@/lib/auth";
import { getTeachingMediaUrl } from "@/lib/training";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { TeachingPlayer } from "./teaching-player";
import { formatDuration } from "@/lib/format";

export default async function TeachingPage({
  params,
}: {
  params: Promise<{ teachingId: string }>;
}) {
  const { teachingId } = await params;
  const session = await getSessionRoles();
  if (!session) return null;
  const supabase = await createClient();

  // RLS scopes this to published teachings (or anything, for a manager), so an
  // unpublished draft 404s for a plain member rather than leaking.
  const { data: teaching } = await supabase
    .from("training_teachings")
    .select(
      "id, series_id, position, title, description, media_type, storage_path, external_url, duration_seconds, is_published"
    )
    .eq("id", teachingId)
    .maybeSingle();
  if (!teaching) notFound();

  const [{ data: series }, { data: progress }, { data: siblings }] = await Promise.all([
    supabase
      .from("training_series")
      .select("id, title")
      .eq("id", teaching.series_id)
      .maybeSingle(),
    supabase
      .from("teaching_progress")
      .select("listened_seconds, furthest_seconds, completed, completion_source")
      .eq("user_id", session.userId)
      .eq("teaching_id", teaching.id)
      .maybeSingle(),
    supabase
      .from("training_teachings")
      .select("id, position, title")
      .eq("series_id", teaching.series_id)
      .eq("is_published", true)
      .order("position", { ascending: true }),
  ]);

  // Uploaded media lives in a private bucket, so mint a short-lived signed URL
  // per view rather than making the bucket public.
  const mediaUrl =
    teaching.media_type === "link"
      ? teaching.external_url
      : teaching.storage_path
      ? await getTeachingMediaUrl(teaching.storage_path)
      : null;

  const list = siblings ?? [];
  const index = list.findIndex((t) => t.id === teaching.id);
  const prev = index > 0 ? list[index - 1] : null;
  const next = index >= 0 && index < list.length - 1 ? list[index + 1] : null;

  return (
    <div>
      <PageHeader
        title={teaching.title}
        description={[
          series?.title,
          `Teaching ${teaching.position}`,
          formatDuration(teaching.duration_seconds),
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      {!teaching.is_published && (
        <p className="mb-4 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-2.5 text-sm">
          This teaching is still a draft — only you can see it.
        </p>
      )}

      {teaching.description && (
        <p className="mb-4 text-sm text-[var(--text-muted)]">{teaching.description}</p>
      )}

      <TeachingPlayer
        teachingId={teaching.id}
        mediaType={teaching.media_type}
        mediaUrl={mediaUrl}
        durationSeconds={teaching.duration_seconds}
        furthestSeconds={progress?.furthest_seconds ?? 0}
        listenedSeconds={progress?.listened_seconds ?? 0}
        completed={progress?.completed ?? false}
        completedManually={progress?.completion_source === "manual"}
      />

      <div className="mt-6 flex items-center justify-between gap-3">
        {prev ? (
          <Link href={`/training/${prev.id}`}>
            <Button variant="outline" size="sm">
              <ChevronLeft className="h-4 w-4" />
              <span className="max-w-[10rem] truncate">{prev.title}</span>
            </Button>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/training/${next.id}`}>
            <Button variant="outline" size="sm">
              <span className="max-w-[10rem] truncate">{next.title}</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        ) : (
          <Link href="/training">
            <Button variant="ghost" size="sm">
              Back to all training
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}
