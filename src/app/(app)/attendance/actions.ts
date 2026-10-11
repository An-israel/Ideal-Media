"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionRoles } from "@/lib/auth";
import { chunk } from "@/lib/pagination";
import { isLate, hasOccurred } from "@/lib/attendance-window";
import { parseAbsenteeReport, checkDeclaredCounts } from "@/lib/absentee-parse";
import { buildNameIndex, matchAll } from "@/lib/name-match";
import { getSubunitRoster, getDepartmentRoster, getRecordsFor } from "@/lib/attendance-queries";
import { recomputeMissedService } from "@/lib/welfare-automation";
import { PAGE_SIZE } from "@/lib/constants";
import type { AbsenceReason, AttendanceStatus } from "@/lib/database.types";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Who may record attendance for a subunit.
 *
 * Leaders are confined to the subunits they actually lead. Secretary, welfare
 * and the super admin may act for any, which is what keeps a week recoverable
 * when a leader is unreachable past the deadline.
 */
async function authorizeSubunit(subunitId: string) {
  const session = await getSessionRoles();
  if (!session) throw new Error("You're signed out — please log in again.");
  const privileged =
    session.roles.includes("super_admin") ||
    session.roles.includes("secretary") ||
    session.roles.includes("welfare");
  if (!privileged && !session.ledSubunitIds.includes(subunitId)) {
    throw new Error("You can only submit attendance for a subunit you lead.");
  }
  return { session, privileged };
}

async function authorizeDepartment() {
  const session = await getSessionRoles();
  if (!session) throw new Error("You're signed out — please log in again.");
  if (
    !session.roles.includes("super_admin") &&
    !session.roles.includes("secretary") &&
    !session.roles.includes("welfare")
  ) {
    throw new Error("Only the secretary, welfare or an admin can do this.");
  }
  return session;
}

/**
 * Refuses a service date that has not arrived yet.
 *
 * Every page hides the form for a future service, but the date travels in the
 * URL, so the rule is enforced here too — recording who attended a service
 * nobody has held is invented data, and it would also open welfare follow-ups
 * for an absence that has not happened.
 */
function assertServiceHeld(serviceDate: string) {
  if (!hasOccurred(serviceDate)) {
    throw new Error("That service hasn't happened yet, so there is nothing to report.");
  }
}

export interface AttendanceMark {
  userId: string;
  status: AttendanceStatus;
  absenceReason: AbsenceReason | null;
  absenceNote: string | null;
}

/**
 * Writes one subunit's attendance for a service.
 *
 * Marks are upserted on (user, activity, date), so re-submitting a correction
 * replaces rather than duplicates. The submission row records who, when, and
 * whether it beat the 8PM deadline.
 */
export async function submitAttendance(input: {
  subunitId: string;
  activityId: string;
  serviceDate: string;
  marks: AttendanceMark[];
}): Promise<ActionResult> {
  try {
    const { session, privileged } = await authorizeSubunit(input.subunitId);
    assertServiceHeld(input.serviceDate);
    const admin = createAdminClient();

    // Never trust the client's list of people: rebuild it from the roster, so a
    // tampered payload can't record attendance for somebody in another subunit.
    const roster = await getSubunitRoster([input.subunitId]);
    const allowed = new Set(roster.map((r) => r.userId));
    const marks = input.marks.filter((m) => allowed.has(m.userId));
    if (marks.length === 0) {
      return { ok: false, error: "Nobody on this subunit's roster was in that submission." };
    }

    const late = isLate(input.serviceDate);
    const existing = await getSubmissions(input.subunitId, input.activityId, input.serviceDate);

    // Past the deadline a leader can no longer change their own submission;
    // secretary/welfare/admin can, and the amendment is recorded.
    if (existing && late && !privileged) {
      return {
        ok: false,
        error:
          "The deadline for this service has passed. Ask the secretary or welfare to make the correction.",
      };
    }

    const rows = marks.map((m) => ({
      user_id: m.userId,
      activity_id: input.activityId,
      service_date: input.serviceDate,
      status: m.status,
      source: "leader_submission" as const,
      // The database rejects a reason on a present row; strip it here so a
      // stale selection in the form can't fail the whole submission.
      absence_reason: m.status === "present" ? null : m.absenceReason,
      absence_note: m.status === "present" ? null : m.absenceNote,
      recorded_by: session.userId,
      recorded_at: new Date().toISOString(),
    }));

    for (const batch of chunk(rows, PAGE_SIZE)) {
      const { error } = await admin
        .from("attendance_records")
        .upsert(batch, { onConflict: "user_id,activity_id,service_date" });
      if (error) return { ok: false, error: error.message };
    }

    const present = marks.filter((m) => m.status === "present").length;
    const { error: subErr } = await admin.from("attendance_submissions").upsert(
      {
        subunit_id: input.subunitId,
        activity_id: input.activityId,
        service_date: input.serviceDate,
        submitted_by: existing?.submitted_by ?? session.userId,
        submitted_at: existing?.submitted_at ?? new Date().toISOString(),
        is_late: existing?.is_late ?? late,
        no_service: false,
        no_service_reason: null,
        present_count: present,
        absent_count: marks.length - present,
        ...(existing ? { amended_by: session.userId, amended_at: new Date().toISOString() } : {}),
      },
      { onConflict: "subunit_id,activity_id,service_date" }
    );
    if (subErr) return { ok: false, error: subErr.message };

    await afterAttendanceChange(input.activityId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save." };
  }
}

async function getSubmissions(subunitId: string, activityId: string, serviceDate: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("attendance_submissions")
    .select("submitted_by, submitted_at, is_late")
    .eq("subunit_id", subunitId)
    .eq("activity_id", activityId)
    .eq("service_date", serviceDate)
    .maybeSingle();
  return data;
}

/** Recomputes welfare flags, now that Bible Study is an attendance signal too. */
async function afterAttendanceChange(activityId: string) {
  const admin = createAdminClient();
  const { data: activity } = await admin
    .from("activities")
    .select("is_attendance_signal")
    .eq("id", activityId)
    .maybeSingle();
  if (activity?.is_attendance_signal) {
    await recomputeMissedService(activityId).catch((e) =>
      console.error("[attendance] welfare recompute failed:", e)
    );
  }
  revalidatePath("/attendance");
  revalidatePath("/secretary");
  revalidatePath("/welfare");
  revalidatePath("/dashboard");
}

/** Closes a week with no service — a holiday, camp or church programme. */
export async function markNoService(input: {
  subunitId: string;
  activityId: string;
  serviceDate: string;
  reason: string;
}): Promise<ActionResult> {
  try {
    const { session } = await authorizeSubunit(input.subunitId);
    assertServiceHeld(input.serviceDate);
    const admin = createAdminClient();

    const { error } = await admin.from("attendance_submissions").upsert(
      {
        subunit_id: input.subunitId,
        activity_id: input.activityId,
        service_date: input.serviceDate,
        submitted_by: session.userId,
        submitted_at: new Date().toISOString(),
        is_late: isLate(input.serviceDate),
        no_service: true,
        no_service_reason: input.reason.trim() || null,
        present_count: 0,
        absent_count: 0,
      },
      { onConflict: "subunit_id,activity_id,service_date" }
    );
    if (error) return { ok: false, error: error.message };

    // Nobody is absent in a week that didn't happen, so clear any marks already
    // recorded for this subunit's people.
    const roster = await getSubunitRoster([input.subunitId]);
    if (roster.length > 0) {
      await admin
        .from("attendance_records")
        .delete()
        .eq("activity_id", input.activityId)
        .eq("service_date", input.serviceDate)
        .in("user_id", roster.map((r) => r.userId));
    }

    await afterAttendanceChange(input.activityId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save." };
  }
}

// ---------------------------------------------------------------- paste flow --

export interface PastePreviewRow {
  written: string;
  matchedUserId: string | null;
  matchedName: string | null;
  confidence: "exact" | "same-tokens" | "subset" | "ambiguous" | "none";
  reason: AbsenceReason;
  note: string | null;
  options: { id: string; fullName: string }[];
  /** What this would change from, when a record already exists. */
  wasStatus: AttendanceStatus | null;
}

export interface PastePreview {
  activityId: string;
  serviceDate: string;
  rows: PastePreviewRow[];
  unmatched: string[];
  willMarkPresent: number;
  willMarkAbsent: number;
  changingFromPresent: number;
  countWarnings: { heading: string; declared: number; found: number }[];
  declaredTotalMembers: number | null;
  declaredAbsent: number | null;
  rollTotal: number;
  orphanLines: { line: number; text: string }[];
  unknownHeadings: { line: number; text: string }[];
}

/**
 * Reads a pasted absentee report and works out what it would change — without
 * writing anything.
 *
 * Welfare's list is department-wide and overwrites what leaders submitted, so
 * showing the diff first is the difference between a correction and silently
 * destroying a leader's work.
 */
export async function previewAbsenteePaste(input: {
  activityId: string;
  serviceDate: string;
  text: string;
}): Promise<{ ok: true; preview: PastePreview } | { ok: false; error: string }> {
  try {
    await authorizeDepartment();
    assertServiceHeld(input.serviceDate);
    const parsed = parseAbsenteeReport(input.text);
    if (parsed.absentees.length === 0) {
      return {
        ok: false,
        error:
          "No absentees were found in that text. Check it includes the category headings, e.g. “*Travelled: 4*”.",
      };
    }

    const roster = await getDepartmentRoster();
    const index = buildNameIndex(roster.map((r) => ({ id: r.userId, fullName: r.fullName })));
    const resolved = matchAll(parsed.absentees, index);
    const existing = await getRecordsFor(input.activityId, input.serviceDate);

    const rows: PastePreviewRow[] = resolved.map((r) => ({
      written: r.written,
      matchedUserId: r.match.id,
      matchedName: r.match.fullName,
      confidence: r.match.kind,
      reason: r.row.reason,
      note: r.row.note,
      options: r.match.options.map((o) => ({ id: o.id, fullName: o.fullName })),
      wasStatus: r.match.id ? existing.get(r.match.id)?.status ?? null : null,
    }));

    const matchedIds = new Set(rows.map((r) => r.matchedUserId).filter(Boolean) as string[]);
    const changingFromPresent = rows.filter((r) => r.wasStatus === "present").length;

    return {
      ok: true,
      preview: {
        activityId: input.activityId,
        serviceDate: input.serviceDate,
        rows,
        unmatched: rows.filter((r) => !r.matchedUserId).map((r) => r.written),
        willMarkAbsent: matchedIds.size,
        willMarkPresent: roster.length - matchedIds.size,
        changingFromPresent,
        countWarnings: checkDeclaredCounts(parsed).map((c) => ({
          heading: c.heading,
          declared: c.declared,
          found: c.found,
        })),
        declaredTotalMembers: parsed.totalMembers,
        declaredAbsent: parsed.declaredAbsent,
        rollTotal: roster.length,
        orphanLines: parsed.orphanLines,
        unknownHeadings: parsed.unknownHeadings,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read that report." };
  }
}

/**
 * Applies a previewed paste: named people absent with their category, everyone
 * else on the roll present.
 *
 * Takes the resolved pairs rather than the raw text so that what is written is
 * exactly what was shown and approved — re-parsing here could produce a
 * different result from the one the person confirmed.
 */
export async function commitAbsenteePaste(input: {
  activityId: string;
  serviceDate: string;
  absentees: { userId: string; reason: AbsenceReason; note: string | null }[];
}): Promise<ActionResult & { present?: number; absent?: number }> {
  try {
    const session = await authorizeDepartment();
    assertServiceHeld(input.serviceDate);
    const admin = createAdminClient();
    const roster = await getDepartmentRoster();
    const onRoll = new Set(roster.map((r) => r.userId));

    const absentById = new Map(
      input.absentees.filter((a) => onRoll.has(a.userId)).map((a) => [a.userId, a])
    );

    const now = new Date().toISOString();
    const rows = roster.map((p) => {
      const a = absentById.get(p.userId);
      return {
        user_id: p.userId,
        activity_id: input.activityId,
        service_date: input.serviceDate,
        status: (a ? "absent" : "present") as AttendanceStatus,
        source: "absentee_paste" as const,
        absence_reason: a ? a.reason : null,
        absence_note: a ? a.note : null,
        recorded_by: session.userId,
        recorded_at: now,
      };
    });

    for (const batch of chunk(rows, PAGE_SIZE)) {
      const { error } = await admin
        .from("attendance_records")
        .upsert(batch, { onConflict: "user_id,activity_id,service_date" });
      if (error) return { ok: false, error: error.message };
    }

    // Record a submission per subunit so the compliance view reflects that the
    // week is covered, however it was entered.
    const bySubunit = new Map<string, { present: number; absent: number }>();
    for (const p of roster) {
      const t = bySubunit.get(p.subunitId) ?? { present: 0, absent: 0 };
      if (absentById.has(p.userId)) t.absent++;
      else t.present++;
      bySubunit.set(p.subunitId, t);
    }
    const late = isLate(input.serviceDate);
    const submissions = [...bySubunit.entries()].map(([subunitId, t]) => ({
      subunit_id: subunitId,
      activity_id: input.activityId,
      service_date: input.serviceDate,
      submitted_by: session.userId,
      submitted_at: now,
      is_late: late,
      no_service: false,
      no_service_reason: null,
      present_count: t.present,
      absent_count: t.absent,
    }));
    if (submissions.length > 0) {
      const { error } = await admin
        .from("attendance_submissions")
        .upsert(submissions, { onConflict: "subunit_id,activity_id,service_date" });
      if (error) return { ok: false, error: error.message };
    }

    await afterAttendanceChange(input.activityId);
    return { ok: true, present: rows.length - absentById.size, absent: absentById.size };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save." };
  }
}
