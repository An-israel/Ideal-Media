"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { signUpAction } from "./actions";
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
import { cn } from "@/lib/utils";

type Subunit = { id: string; name: string; category: string };

export function SignupForm({
  primary,
  secondary,
}: {
  primary: Subunit[];
  secondary: Subunit[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    location: "",
    whatsappNumber: "",
    password: "",
  });
  const [primaryId, setPrimaryId] = useState("");
  const [secondaryIds, setSecondaryIds] = useState<string[]>([]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function goToSubunits(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setStep(2);
  }

  function toggleSecondary(id: string) {
    setSecondaryIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    );
  }

  async function submit() {
    setError(null);
    if (!primaryId) {
      setError("Please pick one primary subunit.");
      return;
    }
    setLoading(true);
    const result = await signUpAction({
      ...form,
      primarySubunitId: primaryId,
      secondarySubunitIds: secondaryIds,
    });
    if (!result.ok) {
      setLoading(false);
      setError(result.error ?? "Something went wrong.");
      return;
    }
    // Sign in with the new credentials, then head to the COC gate.
    const supabase = createClient();
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: result.signInEmail ?? form.email,
      password: form.password,
    });
    setLoading(false);
    if (signInErr) {
      setError("Account created — please sign in.");
      router.push("/login");
      return;
    }
    router.push("/coc");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{step === 1 ? "Create your account" : "Choose your subunits"}</CardTitle>
        <CardDescription>
          {step === 1
            ? "Join the media team."
            : "Pick the one primary subunit you serve in, plus any secondary subunits."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {step === 1 ? (
          <form onSubmit={goToSubunits} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full name</Label>
              <Input id="fullName" required value={form.fullName} onChange={set("fullName")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={form.email} onChange={set("email")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" value={form.phone} onChange={set("phone")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Where you stay</Label>
                <Input id="location" value={form.location} onChange={set("location")} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="whatsapp">WhatsApp number</Label>
              <Input
                id="whatsapp"
                placeholder="+234…"
                value={form.whatsappNumber}
                onChange={set("whatsappNumber")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <PasswordInput id="password" required value={form.password} onChange={set("password")} />
            </div>
            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
            <Button type="submit" className="w-full">
              Continue
            </Button>
          </form>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Primary subunit (pick one)</Label>
              <div className="grid grid-cols-1 gap-2">
                {primary.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setPrimaryId(s.id)}
                    className={cn(
                      "flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors",
                      primaryId === s.id
                        ? "border-[var(--accent)] bg-[var(--accent)]/8"
                        : "border-[var(--border)] hover:bg-[var(--bg)]"
                    )}
                  >
                    {s.name}
                    {primaryId === s.id && <Check className="h-4 w-4 text-[var(--accent)]" />}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Secondary subunits (optional)</Label>
              <div className="flex flex-wrap gap-2">
                {secondary.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleSecondary(s.id)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition-colors",
                      secondaryIds.includes(s.id)
                        ? "border-[var(--accent)] bg-[var(--accent)]/8 text-[var(--accent)]"
                        : "border-[var(--border)] hover:bg-[var(--bg)]"
                    )}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button className="flex-1" onClick={submit} disabled={loading}>
                {loading ? "Creating…" : "Create account"}
              </Button>
            </div>
          </div>
        )}
        <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
          Already have an account?{" "}
          <Link href="/login" className="text-[var(--accent)] hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
