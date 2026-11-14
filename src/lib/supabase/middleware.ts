import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { learnRedirect } from "@/lib/learn-routing";

/** Public, unauthenticated routes (Section 6: no landing page → /login). */
// /verify is the public certificate check: the person a certificate is shown
// to has no account, so it must work signed out.
// /learn/signup is where course-only learners register, so it is open too.
const PUBLIC_PATHS = ["/login", "/signup", "/reset-password", "/auth", "/verify", "/learn/signup"];

const ROLE_GATES: { prefix: string; roles: string[] }[] = [
  { prefix: "/admin", roles: ["super_admin"] },
  { prefix: "/leader", roles: ["subunit_leader", "super_admin"] },
  { prefix: "/secretary", roles: ["secretary", "super_admin"] },
  { prefix: "/welfare", roles: ["welfare", "super_admin"] },
];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  // Unauthenticated → only public routes.
  if (!user) {
    if (isPublic) return response;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Authenticated on an auth page → send to dashboard (which, for a learner,
  // is turned into /learn just below).
  if (path === "/login" || path === "/signup" || path === "/learn/signup") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  if (isPublic) return response;

  // COC gate (Section 6): block everything until coc_completed, except /coc.
  const { data: profile } = await supabase
    .from("profiles")
    .select("coc_completed")
    .eq("id", user.id)
    .maybeSingle();

  // Course-only learners have a login but no profile. They belong in /learn
  // and nowhere else: not the dashboard, not the Code of Conduct (which is the
  // department's), not any screen that reads or writes the department's
  // records. Members, in turn, have the academy inside the main app, so /learn
  // sends them to the same page there. The rule itself is learnRedirect(),
  // which is tested. A failed lookup (the table not created yet) reads as
  // "not a learner", which is the old behaviour.
  let kind: "learner" | "member" | "neither" = profile ? "member" : "neither";
  if (!profile) {
    const { data: learner } = await supabase
      .from("learners")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    if (learner) kind = "learner";
  }
  const learnTarget = learnRedirect(path, kind);
  if (learnTarget) {
    const url = request.nextUrl.clone();
    url.pathname = learnTarget;
    if (kind === "learner") url.search = "";
    return NextResponse.redirect(url);
  }
  // A learner who is where they belong goes no further: the Code of Conduct
  // and role checks below are the department's, and a learner has neither.
  if (kind === "learner") return response;

  // /access-removed is exempt as well as /coc. Without that, somebody whose
  // access was removed before they ever took the quiz could never reach the
  // page that tells them so: every request was sent to /coc first, which walked
  // a person who is no longer in the unit through the Code of Conduct.
  if (
    !profile?.coc_completed &&
    !path.startsWith("/coc") &&
    !path.startsWith("/access-removed")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/coc";
    return NextResponse.redirect(url);
  }

  // Role-group gating (defense in depth alongside RLS).
  const gate = ROLE_GATES.find((g) => path === g.prefix || path.startsWith(g.prefix + "/"));
  if (gate) {
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const roles = (roleRows ?? []).map((r) => r.role);
    if (!gate.roles.some((r) => roles.includes(r as (typeof roles)[number]))) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
  }

  return response;
}
