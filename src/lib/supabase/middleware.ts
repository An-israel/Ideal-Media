import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";

/** Public, unauthenticated routes (Section 6: no landing page → /login). */
const PUBLIC_PATHS = ["/login", "/signup", "/reset-password", "/auth"];

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

  // Authenticated on an auth page → send to dashboard.
  if (path === "/login" || path === "/signup") {
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
    .single();

  if (!profile?.coc_completed && !path.startsWith("/coc")) {
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
