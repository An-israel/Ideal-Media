import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Auth callback (AUDIT AUTH-1). Every Supabase email link — password recovery,
 * email change, invite — lands here so the code/token can be exchanged for a
 * session cookie before the user reaches a page. Without this route
 * `resetPasswordForEmail` sent people to a form with no session and
 * `updateUser({ password })` failed with "Auth session missing".
 *
 * Handles both link shapes:
 *   - PKCE:   ?code=<uuid>            → exchangeCodeForSession
 *   - OTP:    ?token_hash=…&type=…    → verifyOtp
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // Only ever redirect to a relative path on our own origin.
  const rawNext = searchParams.get("next") ?? "/dashboard";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("That link has expired. Please request a new one.")}`
    );
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("That link has expired. Please request a new one.")}`
    );
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("That link is not valid. Please request a new one.")}`
  );
}
