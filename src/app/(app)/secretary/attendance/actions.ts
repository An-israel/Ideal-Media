"use server";

import { revalidatePath } from "next/cache";
import { getSessionRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  parseAttendance,
  readSheetRows,
  type RosterMember,
} from "@/lib/attendance-parser";
import { recomputeMissedService } from "@/lib/welfare-automation";
import { ACCEPTED_UPLOAD_EXT, MAX_UPLOAD_BYTES } from "@/lib/constants";
import type { AiProposal, AttendanceStatus } from "@/lib/database.types";

async function requireSecretary() {
  const session = await getSessionRoles();
  if (!session) throw new Error("Not authenticated");
  if (!session.roles.includes("secretary") && !session.roles.includes("super_admin")) {
    throw new Error("Secretary access required");
  }
  return session;
}

async function buildRoster(admin: ReturnType<typeof createAdminClient>): Promise<RosterMember[]> {
  const { data } = await admin
    .from("subunit_members")
    .select("user_id, profiles(full_name, member_status), subunits(name)")
    .eq("membership_type", "primary");

  type Row = {
    user_id: string;
    profiles: { full_name: string; member_status: string } | null;
    subunits: { name: string } | null;
  };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.profiles && ["active", "traveled"].includes(r.profiles.member_status))
    .map((r) => ({
      id: r.user_id,
      full_name: r.profiles!.full_name,
      primary_subunit: r.subunits?.name ?? null,
    }));
}

export interface ParseUploadResult {
  uploadId: string;
}

/** Upload → store raw file → SheetJS → Claude → save proposal (Section 12). */
export async function createAndParseUpload(formData: FormData): Promise<ParseUploadResult> {
  await requireSecretary();

  const file = formData.get("file") as File | null;
  const activityId = String(formData.get("activityId") ?? "");
  const serviceDate = String(formData.get("serviceDate") ?? "");
  if (!file || !activityId || !serviceDate) throw new Error("Missing required fields.");

  // Guardrails: type + size.
  const name = file.name.toLowerCase();
  if (!ACCEPTED_UPLOAD_EXT.some((ext) => name.endsWith(ext))) {
    throw new Error("Only .xlsx or .csv files are accepted.");
  }
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("File exceeds the 5MB limit.");

  const admin = createAdminClient();
  const buffer = Buffer.from(await file.arrayBuffer());

  // Create the upload row first (status parsing) so we have an id for the path.
  const { data: upload, error: insertErr } = await admin
    .from("attendance_uploads")
    .insert({
      uploaded_by: (await getSessionRoles())!.userId,
      original_filename: file.name,
      raw_storage_path: "",
      activity_id: activityId,
      service_date: serviceDate,
      status: "parsing",
    })
    .select("id")
    .single();
  if (insertErr || !upload) throw new Error(insertErr?.message ?? "Could not create upload.");

  const storagePath = `attendance/${upload.id}/${file.name}`;
  await admin.storage.from("attendance").upload(storagePath, buffer, {
    contentType: file.type || "application/octet-stream",
    upsert: true,
  });
  await admin
    .from("attendance_uploads")
    .update({ raw_storage_path: storagePath })
    .eq("id", upload.id);

  const rows = readSheetRows(buffer);
  const roster = await buildRoster(admin);

  let proposal: AiProposal;
  try {
    proposal = await parseAttendance(rows, roster);
  } catch {
    // Never commit on parse error — fall back to a manual-review proposal with
    // everyone listed as not-on-sheet so the secretary can map by hand.
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
    .update({ ai_proposal: proposal, status: "needs_review" })
    .eq("id", upload.id);

  revalidatePath("/secretary/attendance");
  return { uploadId: upload.id };
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

  const rows = decisions.map((d) => ({
    user_id: d.userId,
    activity_id: upload.activity_id,
    service_date: upload.service_date,
    status: d.status,
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

  // @ts-expect-error supabase embed typing
  if (upload.activities?.is_attendance_signal) {
    await recomputeMissedService(upload.activity_id);
  }

  revalidatePath("/secretary/attendance");
  revalidatePath("/welfare");
}

export async function discardUpload(uploadId: string) {
  await requireSecretary();
  const admin = createAdminClient();
  await admin.from("attendance_uploads").update({ status: "discarded" }).eq("id", uploadId);
  revalidatePath("/secretary/attendance");
}
