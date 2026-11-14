"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { signUpLearner } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function LearnerSignupForm() {
  const router = useRouter();
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", password: "", website: "" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    const result = await signUpLearner(form);
    if (!result.ok) {
      setLoading(false);
      setError(result.error ?? "Something went wrong.");
      return;
    }
    if (result.needsEmailConfirmation) {
      setLoading(false);
      setNotice("Account created. Check your email for a confirmation link, then log in.");
      return;
    }
    const supabase = createClient();
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: result.signInEmail ?? form.email,
      password: form.password,
    });
    setLoading(false);
    if (signInErr) {
      setNotice("Account created — please log in.");
      router.push("/login");
      return;
    }
    router.push("/learn");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Join the Skills Academy</CardTitle>
        <CardDescription>
          22 free courses — graphic design, video editing, photography, web development and more.
          Learn at your own pace and earn a certificate for each course you finish.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {notice ? (
          <p className="rounded-lg border border-[var(--success)]/30 bg-[var(--success)]/10 px-3 py-2 text-sm">
            {notice}
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full name</Label>
              <Input id="fullName" required value={form.fullName} onChange={set("fullName")} />
              <p className="text-xs text-[var(--text-muted)]">Printed on your certificates.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={form.email} onChange={set("email")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone (optional)</Label>
              <Input id="phone" inputMode="tel" value={form.phone} onChange={set("phone")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <PasswordInput id="password" required value={form.password} onChange={set("password")} />
            </div>
            {/* Hidden from people, filled in by bots. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label htmlFor="website">Website</label>
              <input id="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
            </div>
            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating your account…" : "Create account"}
            </Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
          Already have an account?{" "}
          <Link href="/login" className="text-[var(--accent)] hover:underline">
            Log in
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-[var(--text-muted)]">
          In the Ideal Life City media department?{" "}
          <Link href="/signup" className="hover:underline">
            Use the member sign-up instead
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
