import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16 renamed the "middleware" convention to "proxy".
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets, image optimization, and
     * /api.
     *
     * /api is excluded deliberately (AUDIT NOTIF-1): route handlers carry no
     * Supabase session cookie, so the session gate here was answering every
     * API request with a 307 to /login. That silently killed the Vercel Cron
     * birthday job — the handler body never ran. API routes authenticate
     * themselves instead (see src/app/api/cron/birthdays/route.ts).
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
