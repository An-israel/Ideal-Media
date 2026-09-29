"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, MessageCircle, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import { normalizePhone } from "@/lib/phone";
import { updateOwnProfile, type ProfileInput } from "./actions";

export interface InstructorCourse {
  id: string;
  title: string;
  isPublished: boolean;
}

export function ProfileForm({
  email,
  initial,
  instructorCourses,
}: {
  email: string;
  initial: ProfileInput;
  instructorCourses: InstructorCourse[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<ProfileInput>(initial);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Previewed live so they can see the number that will actually be dialled —
  // "08031234567" becoming "+2348031234567" is the bit people get wrong.
  const normalized = form.whatsappNumber.trim()
    ? normalizePhone(form.whatsappNumber)
    : null;
  const whatsappInvalid = form.whatsappNumber.trim().length > 0 && normalized === null;
  const teaches = instructorCourses.length > 0;
  const needsWhatsapp = teaches && (!form.whatsappNumber.trim() || whatsappInvalid);

  async function save() {
    setBusy(true);
    try {
      const result = await updateOwnProfile(form);
      if (!result.ok) {
        toast({ title: "Couldn't save", description: result.error, variant: "error" });
        return;
      }
      toast({
        title: result.message ?? "Saved",
        description: result.normalizedWhatsapp
          ? `Members will reach you on +${result.normalizedWhatsapp}.`
          : undefined,
        variant: "success",
      });
      router.refresh();
    } catch (e) {
      toast({
        title: "Something went wrong",
        description: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* The reason a leader is here at all. */}
      {teaches && (
        <Card
          className={
            needsWhatsapp
              ? "border-[var(--danger)]/40 bg-[var(--danger)]/5"
              : "border-[var(--success)]/40 bg-[var(--success)]/5"
          }
        >
          <CardContent className="flex items-start gap-3 py-4">
            {needsWhatsapp ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]" />
            )}
            <div className="space-y-1.5">
              <p className="text-sm font-medium">
                {needsWhatsapp
                  ? "Your courses have no way to receive assignments"
                  : "Members can send you assignments on WhatsApp"}
              </p>
              <p className="text-sm text-[var(--text-muted)]">
                You&apos;re the instructor for{" "}
                {instructorCourses.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ", "}
                    <b>{c.title}</b>
                    {!c.isPublished && " (draft)"}
                  </span>
                ))}
                .{" "}
                {needsWhatsapp
                  ? "Members tap “Submit to leader on WhatsApp” to send you their work — add a valid WhatsApp number below so that button reaches you."
                  : "Their submissions open a WhatsApp chat straight to you."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={email} disabled readOnly />
            <p className="text-xs text-[var(--text-muted)]">
              Your sign-in email. Use &ldquo;Forgot password&rdquo; on the login page to change
              your password.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fullName">Full name</Label>
            <Input
              id="fullName"
              value={form.fullName}
              onChange={(e) => set("fullName", e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="whatsapp">
              WhatsApp number{" "}
              {teaches && <span className="text-[var(--danger)]">· needed for your courses</span>}
            </Label>
            <Input
              id="whatsapp"
              inputMode="tel"
              value={form.whatsappNumber}
              onChange={(e) => set("whatsappNumber", e.target.value)}
              placeholder="08031234567"
              aria-invalid={whatsappInvalid}
            />
            {whatsappInvalid ? (
              <p className="flex items-center gap-1.5 text-xs text-[var(--danger)]">
                <AlertTriangle className="h-3 w-3" />
                That doesn&apos;t look like a valid number.
              </p>
            ) : normalized ? (
              <p className="flex items-center gap-1.5 text-xs text-[var(--success)]">
                <MessageCircle className="h-3 w-3" />
                Members will message <b>+{normalized}</b>
              </p>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">
                A local number like 08031234567 is fine — we add the country code.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone number (optional)</Label>
            <Input
              id="phone"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="Same as WhatsApp, or a different line"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="location">Location (optional)</Label>
            <Input
              id="location"
              value={form.location}
              onChange={(e) => set("location", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Birthday (optional)</Label>
            <div className="flex items-center gap-2">
              <Input
                aria-label="Birthday day"
                inputMode="numeric"
                value={form.birthDay}
                onChange={(e) => set("birthDay", e.target.value.replace(/\D/g, "").slice(0, 2))}
                placeholder="DD"
                className="w-20"
              />
              <span className="text-[var(--text-muted)]">/</span>
              <Input
                aria-label="Birthday month"
                inputMode="numeric"
                value={form.birthMonth}
                onChange={(e) => set("birthMonth", e.target.value.replace(/\D/g, "").slice(0, 2))}
                placeholder="MM"
                className="w-20"
              />
              <Badge variant="neutral">day / month</Badge>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              The welfare team uses this to celebrate you. The year isn&apos;t stored.
            </p>
          </div>

          <Button onClick={save} disabled={busy || whatsappInvalid}>
            <Save className="h-4 w-4" />
            {busy ? "Saving…" : "Save profile"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
