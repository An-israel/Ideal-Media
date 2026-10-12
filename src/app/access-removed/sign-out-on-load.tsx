"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * Clears the session on arrival.
 *
 * Revocation bans the Supabase user and the app layout turns them away, but the
 * cookie in this browser is still there until something removes it. Without
 * this, the person bounces between the app and this page on every navigation.
 */
export function SignOutOnLoad() {
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .signOut()
      .catch(() => {
        // Already invalid server-side, which is the outcome we wanted anyway.
      })
      .finally(() => setDone(true));
  }, []);

  return (
    <Button
      variant="outline"
      className="w-full"
      disabled={!done}
      onClick={() => {
        // A hard navigation, so no cached server component tree comes back.
        window.location.href = "/login";
      }}
    >
      {done ? "Back to sign in" : "Signing you out…"}
    </Button>
  );
}
