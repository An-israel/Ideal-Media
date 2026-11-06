"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { getSessionRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A member's own actions in the academy.
 *
 * Every one of these re-reads the session rather than trusting a user id from
 * the form: a server action is a public endpoint, so "mark this lesson done"
 * must never be able to say whose lesson it is.
 */

async function requireMember() {
  const session = await getSessionRoles();
  if (!session) throw new Error("Not signed in.");
  if (session.accessRevoked) throw new Error("Your access has been removed.");
  return session;
}

export async function setLessonDone(lessonId: string, done: boolean) {
  const session = await requireMember();
  const admin = createAdminClient();

  if (done) {
    const { error } = await admin
      .from("academy_lesson_progress")
      .upsert(
        { user_id: session.userId, lesson_id: lessonId },
        { onConflict: "user_id,lesson_id" }
      );
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin
      .from("academy_lesson_progress")
      .delete()
      .eq("user_id", session.userId)
      .eq("lesson_id", lessonId);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/academy", "layout");
}

export async function submitAssignment(
  assignmentId: string,
  payload: { link?: string; checked?: number[] }
) {
  const session = await requireMember();
  const admin = createAdminClient();

  const { data: assignment } = await admin
    .from("academy_assignments")
    .select("kind, checklist")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!assignment) throw new Error("That assignment no longer exists.");

  if (assignment.kind === "link") {
    const link = (payload.link ?? "").trim();
    // A link assignment with no link is the member pressing submit on an empty
    // box; saying so beats recording an empty submission as done.
    if (!link) throw new Error("Paste the link to your work first.");
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      throw new Error("That doesn't look like a link. It should start with https://");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("That doesn't look like a link. It should start with https://");
    }
    const { error } = await admin.from("academy_submissions").upsert(
      {
        user_id: session.userId,
        assignment_id: assignmentId,
        link: url.toString(),
        checked: [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,assignment_id" }
    );
    if (error) throw new Error(error.message);
  } else {
    const total = (assignment.checklist ?? []).length;
    const checked = [...new Set(payload.checked ?? [])].filter(
      (i) => Number.isInteger(i) && i >= 0 && i < total
    );
    if (checked.length < total) {
      throw new Error("Tick every item before you submit.");
    }
    const { error } = await admin.from("academy_submissions").upsert(
      {
        user_id: session.userId,
        assignment_id: assignmentId,
        link: null,
        checked,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,assignment_id" }
    );
    if (error) throw new Error(error.message);
  }

  revalidatePath("/academy", "layout");
}

/**
 * Issues the certificate, but only if the work is actually done.
 *
 * The check is the database's `academy_course_complete`, not anything the page
 * passed in: the button is only rendered when the page thinks the course is
 * finished, and a button is not a permission.
 */
export async function claimCertificate(courseId: string): Promise<{ code: string }> {
  const session = await requireMember();
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("academy_certificates")
    .select("code")
    .eq("user_id", session.userId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (existing) return { code: existing.code };

  const { data: complete, error: checkError } = await admin.rpc("academy_course_complete", {
    c_id: courseId,
    u_id: session.userId,
  });
  if (checkError) throw new Error(checkError.message);
  if (!complete) throw new Error("Finish every lesson and assignment first.");

  // Short, unambiguous, and not guessable from another certificate: no 0/O or
  // 1/I, so it can be read aloud or typed from a printout.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const body = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  const code = `ILC-${body.slice(0, 4)}-${body.slice(4, 8)}`;

  const { error } = await admin.from("academy_certificates").insert({
    user_id: session.userId,
    course_id: courseId,
    code,
  });
  if (error) {
    // Two clicks at once: whoever lost the race reads the winner's code.
    const { data: now } = await admin
      .from("academy_certificates")
      .select("code")
      .eq("user_id", session.userId)
      .eq("course_id", courseId)
      .maybeSingle();
    if (now) return { code: now.code };
    throw new Error(error.message);
  }

  revalidatePath("/academy", "layout");
  return { code };
}
