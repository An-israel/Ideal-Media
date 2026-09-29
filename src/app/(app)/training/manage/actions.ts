"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyMany } from "@/lib/notify";
import { fetchAllRows } from "@/lib/pagination";
import { requireTrainingManager } from "../actions";
import {
  MAX_TEACHING_UPLOAD_BYTES,
  ACCEPTED_TEACHING_AUDIO,
  ACCEPTED_TEACHING_VIDEO,
} from "@/lib/constants";
import type { TeachingMediaType } from "@/lib/database.types";

/** Strips path separators and control characters from an uploaded filename. */
function safeFilename(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, "_")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
  return cleaned.slice(0, 180) || "teaching";
}

// ------------------------------------------------------------------ series --

export async function createSeries(input: { title: string; description: string }) {
  await requireTrainingManager();
  if (!input.title.trim()) throw new Error("A series needs a title.");

  const admin = createAdminClient();
  const { data: last } = await admin
    .from("training_series")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await admin
    .from("training_series")
    .insert({
      title: input.title.trim(),
      description: input.description.trim() || null,
      position: (last?.position ?? 0) + 1,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/training/manage");
  return data.id;
}

export async function updateSeries(input: {
  seriesId: string;
  title: string;
  description: string;
}) {
  await requireTrainingManager();
  if (!input.title.trim()) throw new Error("A series needs a title.");

  const admin = createAdminClient();
  const { error } = await admin
    .from("training_series")
    .update({
      title: input.title.trim(),
      description: input.description.trim() || null,
    })
    .eq("id", input.seriesId);
  if (error) throw new Error(error.message);

  revalidatePath("/training/manage");
  revalidatePath("/training");
}

/**
 * Publishes or unpublishes a series. Publishing notifies every active member
 * that there is new training to listen to — otherwise nobody knows it exists.
 */
export async function setSeriesPublished(seriesId: string, publish: boolean) {
  await requireTrainingManager();
  const admin = createAdminClient();

  const { data: series, error } = await admin
    .from("training_series")
    .update({ is_published: publish })
    .eq("id", seriesId)
    .select("title, is_published")
    .single();
  if (error) throw new Error(error.message);

  if (publish) {
    const { count } = await admin
      .from("training_teachings")
      .select("id", { count: "exact", head: true })
      .eq("series_id", seriesId)
      .eq("is_published", true);

    if ((count ?? 0) > 0) {
      const members = await fetchAllRows<{ id: string }>((from, to) =>
        admin
          .from("profiles")
          .select("id")
          .eq("member_status", "active")
          .eq("claimed", true)
          .range(from, to)
      );
      await notifyMany(
        members.map((m) => ({
          userId: m.id,
          type: "training_published",
          title: "New training available",
          body: `"${series.title}" is now available in General Training.`,
          link: "/training",
        }))
      );
    }
  }

  revalidatePath("/training/manage");
  revalidatePath("/training");
  revalidatePath("/dashboard");
}

/**
 * Deletes a series and its teachings, including the uploaded media.
 * Refuses once members have listen history, so a report isn't silently erased.
 */
export async function deleteSeries(seriesId: string) {
  await requireTrainingManager();
  const admin = createAdminClient();

  const { data: teachings } = await admin
    .from("training_teachings")
    .select("id, storage_path")
    .eq("series_id", seriesId);

  const ids = (teachings ?? []).map((t) => t.id);
  if (ids.length) {
    const { count } = await admin
      .from("teaching_progress")
      .select("id", { count: "exact", head: true })
      .in("teaching_id", ids);
    if ((count ?? 0) > 0) {
      throw new Error(
        `${count} member(s) have listen history in this series, so it can't be deleted. Unpublish it instead.`
      );
    }
  }

  const paths = (teachings ?? [])
    .map((t) => t.storage_path)
    .filter((p): p is string => !!p);
  if (paths.length) {
    const { error: rmErr } = await admin.storage.from("training").remove(paths);
    if (rmErr) console.error("[training] could not remove media:", rmErr.message);
  }

  const { error } = await admin.from("training_series").delete().eq("id", seriesId);
  if (error) throw new Error(error.message);

  revalidatePath("/training/manage");
  revalidatePath("/training");
}

// ---------------------------------------------------------------- teachings --

export interface CreateTeachingResult {
  teachingId: string;
}

export interface UploadTarget {
  /** Object key to upload to, and to pass back to finalizeTeaching. */
  path: string;
  /** Single-use token authorising the upload. */
  token: string;
}

/** Extensions we accept, by media type. */
function acceptedFor(mediaType: TeachingMediaType): readonly string[] {
  return mediaType === "video" ? ACCEPTED_TEACHING_VIDEO : ACCEPTED_TEACHING_AUDIO;
}

/**
 * Mints a signed URL the BROWSER uploads the media straight to.
 *
 * Teaching audio runs to tens or hundreds of megabytes. Posting that through a
 * server action does not work — Next caps a server action body at 1MB by
 * default, and raising the cap to 200MB would mean buffering the whole file in
 * the Next process for no reason. So the file goes browser → Supabase Storage
 * directly, and the server's job is just to authorise it and record the row.
 *
 * The role check happens HERE, before the token is minted, which is what keeps
 * the private bucket private.
 */
export async function prepareTeachingUpload(input: {
  seriesId: string;
  filename: string;
  mediaType: TeachingMediaType;
  sizeBytes: number;
}): Promise<UploadTarget> {
  await requireTrainingManager();

  if (!input.seriesId) throw new Error("Pick a series.");
  if (input.mediaType === "link") throw new Error("A link teaching needs no upload.");
  if (!input.sizeBytes || input.sizeBytes <= 0) throw new Error("That file looks empty.");
  if (input.sizeBytes > MAX_TEACHING_UPLOAD_BYTES) {
    const mb = Math.round(MAX_TEACHING_UPLOAD_BYTES / (1024 * 1024));
    throw new Error(`That file is larger than the ${mb}MB limit.`);
  }

  const accepted = acceptedFor(input.mediaType);
  const lower = input.filename.toLowerCase();
  if (!accepted.some((ext) => lower.endsWith(ext))) {
    throw new Error(`For ${input.mediaType}, use one of: ${accepted.join(", ")}.`);
  }

  const admin = createAdminClient();

  // Confirm the series exists before handing out an upload token for it.
  const { data: series } = await admin
    .from("training_series")
    .select("id")
    .eq("id", input.seriesId)
    .maybeSingle();
  if (!series) throw new Error("That series no longer exists.");

  const path = `${input.seriesId}/${randomUUID()}-${safeFilename(input.filename)}`;
  const { data, error } = await admin.storage.from("training").createSignedUploadUrl(path);
  if (error || !data) {
    throw new Error(`Could not start the upload: ${error?.message ?? "unknown error"}`);
  }

  return { path: data.path, token: data.token };
}

/**
 * Records a teaching whose media is already in storage (uploaded via
 * prepareTeachingUpload), or one that is just a link.
 *
 * For an upload it verifies the object is actually there first, so a failed or
 * abandoned browser upload can't leave a row pointing at nothing.
 */
export async function finalizeTeaching(input: {
  seriesId: string;
  title: string;
  description: string;
  mediaType: TeachingMediaType;
  /** Set for audio/video, from prepareTeachingUpload. */
  storagePath?: string;
  /** Set for a link teaching. */
  externalUrl?: string;
}): Promise<CreateTeachingResult> {
  await requireTrainingManager();

  const title = input.title.trim();
  const description = input.description.trim();
  if (!input.seriesId) throw new Error("Pick a series.");
  if (!title) throw new Error("A teaching needs a title.");

  const admin = createAdminClient();
  let storagePath: string | null = null;
  let externalUrl: string | null = null;

  if (input.mediaType === "link") {
    const url = (input.externalUrl ?? "").trim();
    if (!url) throw new Error("Paste the link to the teaching.");
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("bad protocol");
      }
    } catch {
      throw new Error("That doesn't look like a valid link.");
    }
    externalUrl = url;
  } else {
    storagePath = (input.storagePath ?? "").trim();
    if (!storagePath) throw new Error("The upload didn't complete — please try again.");

    // The path is server-generated (prepareTeachingUpload), but it arrives back
    // from the client, so confirm it is inside this series' folder and that the
    // object really exists rather than trusting it.
    if (!storagePath.startsWith(`${input.seriesId}/`)) {
      throw new Error("That upload doesn't belong to this series.");
    }
    const slash = storagePath.lastIndexOf("/");
    const { data: listed, error: listErr } = await admin.storage
      .from("training")
      .list(storagePath.slice(0, slash), { search: storagePath.slice(slash + 1) });
    if (listErr) throw new Error(`Could not verify the upload: ${listErr.message}`);
    if (!listed || listed.length === 0) {
      throw new Error("The uploaded file wasn't found in storage — please try again.");
    }
  }

  const { data: last } = await admin
    .from("training_teachings")
    .select("position")
    .eq("series_id", input.seriesId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: created, error } = await admin
    .from("training_teachings")
    .insert({
      series_id: input.seriesId,
      position: (last?.position ?? 0) + 1,
      title,
      description: description || null,
      media_type: input.mediaType,
      storage_path: storagePath,
      external_url: externalUrl,
    })
    .select("id")
    .single();

  if (error || !created) {
    // Don't leave an orphaned file in the bucket if the row failed.
    if (storagePath) {
      const { error: rmErr } = await admin.storage.from("training").remove([storagePath]);
      if (rmErr) console.error(`[training] orphaned upload ${storagePath}:`, rmErr.message);
    }
    throw new Error(error?.message ?? "Could not add the teaching.");
  }

  revalidatePath("/training/manage");
  revalidatePath("/training");
  return { teachingId: created.id };
}

export async function updateTeaching(input: {
  teachingId: string;
  title: string;
  description: string;
}) {
  await requireTrainingManager();
  if (!input.title.trim()) throw new Error("A teaching needs a title.");

  const admin = createAdminClient();
  const { error } = await admin
    .from("training_teachings")
    .update({
      title: input.title.trim(),
      description: input.description.trim() || null,
    })
    .eq("id", input.teachingId);
  if (error) throw new Error(error.message);

  revalidatePath("/training/manage");
  revalidatePath("/training");
}

export async function setTeachingPublished(teachingId: string, publish: boolean) {
  await requireTrainingManager();
  const admin = createAdminClient();
  const { error } = await admin
    .from("training_teachings")
    .update({ is_published: publish })
    .eq("id", teachingId);
  if (error) throw new Error(error.message);

  revalidatePath("/training/manage");
  revalidatePath("/training");
  revalidatePath("/dashboard");
}

/** Deletes a teaching and its media. Refuses once it has listen history. */
export async function deleteTeaching(teachingId: string) {
  await requireTrainingManager();
  const admin = createAdminClient();

  const { count } = await admin
    .from("teaching_progress")
    .select("id", { count: "exact", head: true })
    .eq("teaching_id", teachingId);
  if ((count ?? 0) > 0) {
    throw new Error(
      `${count} member(s) have listen history for this teaching, so it can't be deleted. Unpublish it instead.`
    );
  }

  const { data: teaching } = await admin
    .from("training_teachings")
    .select("storage_path")
    .eq("id", teachingId)
    .maybeSingle();

  const { error } = await admin.from("training_teachings").delete().eq("id", teachingId);
  if (error) throw new Error(error.message);

  if (teaching?.storage_path) {
    const { error: rmErr } = await admin.storage
      .from("training")
      .remove([teaching.storage_path]);
    if (rmErr) console.error("[training] could not remove media:", rmErr.message);
  }

  revalidatePath("/training/manage");
  revalidatePath("/training");
}

/**
 * Nudges members who haven't finished a teaching yet.
 *
 * This is the point of the report — seeing that 12 people haven't listened is
 * only useful if you can do something about it from the same screen.
 */
export async function remindNotListened(teachingId: string): Promise<{ notified: number }> {
  await requireTrainingManager();
  const admin = createAdminClient();

  const { data: teaching } = await admin
    .from("training_teachings")
    .select("title, is_published")
    .eq("id", teachingId)
    .maybeSingle();
  if (!teaching) throw new Error("Teaching not found.");
  if (!teaching.is_published) {
    throw new Error("Publish the teaching before reminding anyone about it.");
  }

  const [members, progress] = await Promise.all([
    fetchAllRows<{ id: string }>((from, to) =>
      admin
        .from("profiles")
        .select("id")
        .eq("member_status", "active")
        .eq("claimed", true)
        .range(from, to)
    ),
    fetchAllRows<{ user_id: string }>((from, to) =>
      admin
        .from("teaching_progress")
        .select("user_id")
        .eq("teaching_id", teachingId)
        .eq("completed", true)
        .range(from, to)
    ),
  ]);

  const done = new Set(progress.map((p) => p.user_id));
  const outstanding = members.filter((m) => !done.has(m.id));

  await notifyMany(
    outstanding.map((m) => ({
      userId: m.id,
      type: "training_reminder",
      title: "Training still to listen to",
      body: `Please listen to "${teaching.title}" in General Training.`,
      link: "/training",
    }))
  );

  return { notified: outstanding.length };
}
