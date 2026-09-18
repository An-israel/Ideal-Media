"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function ResetPasswordInner() {
  const params = useSearchParams();
  const router = useRouter();
  const mode = params.get("mode") === "update" ? "update" : "request";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    // Route the email link through /auth/callback so the recovery code is
    // exchanged for a session before this form is shown again (AUDIT AUTH-1).
    const next = encodeURIComponent("/reset-password?mode=update");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=${next}`,
    });
    setLoading(false);
    if (error) return setError(error.message);
    setMessage("Check your email for a password reset link.");
  }

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      return setError("Password must be at least 8 characters.");
    }
    setLoading(true);
    const supabase = createClient();

    // /auth/callback should have exchanged the recovery code for a session
    // before we got here. If it didn't, say so plainly instead of surfacing
    // Supabase's "Auth session missing!" (AUDIT AUTH-1).
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return setError(
        "This reset link has expired or was already used. Request a new one below."
      );
    }

    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return setError(error.message);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === "update" ? "Set a new password" : "Reset password"}</CardTitle>
        <CardDescription>
          {mode === "update"
            ? "Enter a new password for your account."
            : "We'll email you a link to reset your password."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {mode === "update" ? (
          <form onSubmit={updatePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <PasswordInput
                id="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Saving…" : "Update password"}
            </Button>
          </form>
        ) : (
          <form onSubmit={requestReset} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
            {message && <p className="text-sm text-[var(--success)]">{message}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
          <Link href="/login" className="text-[var(--accent)] hover:underline">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}
