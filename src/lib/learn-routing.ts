/**
 * Where a signed-in person may go, by what kind of account they hold.
 *
 * A course-only learner belongs in /learn and nowhere else; a department member
 * has the academy inside the main app, so /learn sends them to the same page
 * under /academy. Returns the path to redirect to, or null to let the request
 * through. Kept pure so the rule can be tested without a request.
 */
export function learnRedirect(
  path: string,
  kind: "learner" | "member" | "neither"
): string | null {
  const inLearn = path === "/learn" || path.startsWith("/learn/");
  if (kind === "learner") return inLearn ? null : "/learn";
  if (kind === "member" && inLearn) {
    // /learn/signup is for new learners; a member who opens it has an account.
    if (path === "/learn/signup") return "/academy";
    return path.replace(/^\/learn/, "/academy");
  }
  return null;
}
