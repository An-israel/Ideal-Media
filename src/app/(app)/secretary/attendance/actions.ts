"use server";

import { revalidatePath } from "next/cache";
import { getSessionRoles, type SessionRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  parseAttendance,
  parseAttendanceImages,
  readSheetRows,
  isSupportedImageType,
  SUPPORTED_IMAGE_TYPES,
  type AttendanceImage,
  type RosterMember,
} from "@/lib/attendance-parser";
import { recomputeMissedService } from "@/lib/welfare-automation";
import { fetchAllRows } from "@/lib/pagination";
import { ACCEPTED_UPLOAD_EXT, MAX_UPLOAD_BYTES } from "@/lib/constants";
import type { AiProposal, AttendanceStatus } from "@/lib/database.types";

async function requireSecretary(): Promise<SessionRoles> {
  const session = await getSessionRoles();
  if (!session) throw new Error("Not authenticated");
  if (!session.roles.includes("secretary") && !session.roles.includes("super_admin")) {
    throw new Error("Secretary access required");
  }
  return session;
}

async function buildRoster(admin: ReturnType<typeof createAdminClient>): Promise<RosterMember[]> {
  // Paged: an unbounded select silently caps at 1000 rows, which would drop
  // members off the roster the parser matches against (AUDIT PERF-2).
  type Row = {
    user_id: string;
    profiles: { full_name: string; member_status: string } | null;
    subunits: { name: string } | null;
  };

  const data = await fetchAllRows<Row>((from, to) =>
    admin
      .from("subunit_members")
      .select("user_id, profiles(full_name, member_status), subunits(name)")
      .eq("membership_type", "primary")
      .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>
  );

  return data
    .filter((r) => r.profiles && ["active", "traveled"].includes(r.profiles.member_status))
    .map((r) => ({
      id: r.user_id,
      full_name: r.profiles!.full_name,
      primary_subunit: r.subunits?.name ?? null,
    }));
}

/** Strips path separators and control characters from an uploaded filename. */
function safeFilename(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, "_")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
  return cleaned.slice(0, 180) || "upload";
}

export interface ParseUploadResult {
  uploadId: string;
  /** Set when automatic parsing failed and the sheet needs manual mapping. */
  parseError?: string;
}

/** Upload → store raw file → SheetJS → Claude → save proposal (Section 12). */
export async function createAndParseUpload(formData: FormData): Promise<ParseUploadResult> {
  const session = await requireSecretary();

  // Accept one spreadsheet, or several photos of a multi-page register.
  const files = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  const activityId = String(formData.get("activityId") ?? "");
  const serviceDate = String(formData.get("serviceDate") ?? "");
  if (files.length === 0 || !activityId || !serviceDate) {
    throw new Error("Missing required fields.");
  }

  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  if (totalBytes > MAX_UPLOAD_BYTES) {
    throw new Error("Upload exceeds the 5MB limit.");
  }

  // Guardrails: type + size. Accept spreadsheets OR photos of the sheet.
  const classify = (f: File) => {
    const name = f.name.toLowerCase();
    if (ACCEPTED_UPLOAD_EXT.some((ext) => name.endsWith(ext))) return "sheet" as const;
    if (f.type.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/.test(name)) return "image" as const;
    return "other" as const;
  };
  const kinds = files.map(classify);
  if (kinds.includes("other")) {
    throw new Error("Upload a .xlsx/.csv spreadsheet or photos (jpg/png) of the sheet.");
  }
  const isImage = kinds.every((k) => k === "image");
  if (!isImage && files.length > 1) {
    throw new Error("Upload one spreadsheet at a time (multiple files are for register photos).");
  }

  const admin = createAdminClient();
  const buffers = await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));
  const primaryName = safeFilename(files[0].name);

  // Create the upload row first (status parsing) so we have an id for the path.
  const { data: upload, error: insertErr } = await admin
    .from("attendance_uploads")
    .insert({
      uploaded_by: session.userId,
      original_filename: files.length > 1 ? `${primaryName} (+${files.length - 1} more)` : primaryName,
      raw_storage_path: "",
      activity_id: activityId,
      service_date: serviceDate,
      status: "parsing",
    })
    .select("id")
    .single();
  if (insertErr || !upload) throw new Error(insertErr?.message ?? "Could not create upload.");

  // Store the raw file(s). The upload result is checked now (AUDIT ATT-7) —
  // it used to be discarded while raw_storage_path was written regardless, so
  // the DB claimed an audit copy existed at a path holding nothing.
  const storedPaths: string[] = [];
  for (let i = 0; i < buffers.length; i++) {
    const path = `${upload.id}/${safeFilename(files[i].name)}`;
    const { error: storageErr } = await admin.storage
      .from("attendance")
      .upload(path, buffers[i], {
        contentType: files[i].type || "application/octet-stream",
        upsert: true,
      });
    if (!storageErr) storedPaths.push(path);
    else console.error(`[attendance] storage upload failed for ${path}:`, storageErr.message);
  }
  await admin
    .from("attendance_uploads")
    .update({ raw_storage_path: storedPaths.join(",") })
    .eq("id", upload.id);

  const roster = await buildRoster(admin);
  const rows = isImage ? [] : readSheetRows(buffers[0]);

  if (!isImage && rows.length === 0) {
    await admin
      .from("attendance_uploads")
      .update({ status: "discarded", parse_error: "The sheet had no readable rows." })
      .eq("id", upload.id);
    throw new Error("That sheet looks empty — check the file and try again.");
  }

  let proposal: AiProposal;
  let parseError: string | undefined;
  try {
    if (isImage) {
      const images: AttendanceImage[] = files.map((f, i) => {
        const type = f.type;
        if (!isSupportedImageType(type)) {
          // Previously an unrecognised type was RELABELLED as image/jpeg, so a
          // HEIC from an iPhone was declared as JPEG and failed server-side
          // with a confusing error (AUDIT ATT-9).
          throw new Error(
            `${f.name} is a ${type || "unknown"} image, which can't be read. ` +
              `Use one of: ${SUPPORTED_IMAGE_TYPES.join(", ")}.`
          );
        }
        return { base64: buffers[i].toString("base64"), mediaType: type };
      });
      proposal = await parseAttendanceImages(images, roster);
    } else {
      proposal = await parseAttendance(rows, roster);
    }
  } catch (e) {
    // Never commit on parse error — fall back to a manual-review proposal with
    // everyone listed as not-on-sheet so the secretary can map by hand.
    //
    // The reason is recorded and returned (AUDIT ATT-2). This used to be a bare
    // `catch {}`, so a missing API key, a rate limit and an unreadable sheet
    // were indistinguishable — all three produced a silent empty review screen.
    parseError = e instanceof Error ? e.message : String(e);
    console.error(`[attendance] parse failed for upload ${upload.id}:`, parseError);
    proposal = {
      matches: [],
      unmatched_sheet_rows: rows.map((r) => ({
        name_on_sheet: String(Object.values(r)[0] ?? ""),
        raw: JSON.stringify(r),
        status: "",
      })),
      roster_not_on_sheet: roster.map((m) => ({ roster_id: m.id, full_name: m.full_name })),
    };
  }

  await admin
    .from("attendance_uploads")
    .update({ ai_proposal: proposal, status: "needs_review", parse_error: parseError ?? null })
    .eq("id", upload.id);

  revalidatePath("/secretary/attendance");
  return { uploadId: upload.id, parseError };
}

/** Commits reviewed attendance (privileged) and runs downstream automation. */
export async function commitUpload(
  uploadId: string,
  decisions: { userId: string; status: AttendanceStatus }[]
) {
  await requireSecretary();
  const admin = createAdminClient();

  const { data: upload, error } = await admin
    .from("attendance_uploads")
    .select("activity_id, service_date, status, activities(is_attendance_signal)")
    .eq("id", uploadId)
    .single();
  if (error || !upload) throw new Error("Upload not found.");
  if (upload.status === "committed") throw new Error("Already committed.");
  // A discarded upload used to be committable — only "committed" was checked.
  if (upload.status === "discarded") {
    throw new Error("This upload was discarded. Upload the sheet again to review it.");
  }

  // One record per member: a duplicated decision would make the upsert fail
  // with "ON CONFLICT DO UPDATE command cannot affect row a second time".
  const byUser = new Map<string, AttendanceStatus>();
  for (const d of decisions) byUser.set(d.userId, d.status);

  const rows = [...byUser.entries()].map(([user_id, status]) => ({
    user_id,
    activity_id: upload.activity_id,
    service_date: upload.service_date,
    status,
    source: "sheet_upload" as const,
    upload_id: uploadId,
  }));

  if (rows.length) {
    const { error: upsertErr } = await admin
      .from("attendance_records")
      .upsert(rows, { onConflict: "user_id,activity_id,service_date" });
    if (upsertErr) throw new Error(upsertErr.message);
  }

  await admin
    .from("attendance_uploads")
    .update({ status: "committed", committed_at: new Date().toISOString() })
    .eq("id", uploadId);

  // Embeds aren't modelled in our hand-maintained types (Relationships: []).
  const activities = (upload as unknown as {
    activities: { is_attendance_signal: boolean } | null;
  }).activities;
  if (activities?.is_attendance_signal) {
    await recomputeMissedService(upload.activity_id);
  }

  revalidatePath("/secretary/attendance");
  revalidatePath("/secretary");
  revalidatePath("/welfare");
  revalidatePath("/dashboard");
  revalidatePath("/leader/members");
  revalidatePath("/admin");
}

export async function discardUpload(uploadId: string) {
  await requireSecretary();
  const admin = createAdminClient();
  await admin.from("attendance_uploads").update({ status: "discarded" }).eq("id", uploadId);
  revalidatePath("/secretary/attendance");
}

/**
 * Reopens a committed upload for review (AUDIT ATT-11). A mis-committed sheet
 * previously had no correction path at all — it could only be fixed by editing
 * attendance_records directly in Supabase.
 *
 * The records this upload wrote are removed so a re-commit is a clean replace
 * rather than a merge with the wrong numbers. Records for the same service that
 * came from another upload or from a manual import are left alone.
 */
export async function reopenUpload(uploadId: string) {
  await requireSecretary();
  const admin = createAdminClient();

  const { data: upload } = await admin
    .from("attendance_uploads")
    .select("status, activity_id")
    .eq("id", uploadId)
    .maybeSingle();
  if (!upload) throw new Error("Upload not found.");
  if (upload.status !== "committed") throw new Error("Only a committed upload can be reopened.");

  const { error: delErr } = await admin
    .from("attendance_records")
    .delete()
    .eq("upload_id", uploadId);
  if (delErr) throw new Error(delErr.message);

  const { error: updErr } = await admin
    .from("attendance_uploads")
    .update({ status: "needs_review", committed_at: null })
    .eq("id", uploadId);
  if (updErr) throw new Error(updErr.message);

  // Removing absences can clear a welfare flag, so recompute.
  await recomputeMissedService(upload.activity_id);

  revalidatePath("/secretary/attendance");
  revalidatePath("/welfare");
  revalidatePath("/dashboard");
}
