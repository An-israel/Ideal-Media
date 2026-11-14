"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateLearnerAccount } from "./actions";
import { toast } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export function AccountForm({ fullName, phone }: { fullName: string; phone: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ fullName, phone });

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            value={form.fullName}
            onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
          />
          <p className="text-xs text-[var(--text-muted)]">
            This is the name printed on your certificates, including ones you already have.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone (optional)</Label>
          <Input
            id="phone"
            inputMode="tel"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
        </div>
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await updateLearnerAccount(form);
              if (!r.ok) {
                toast({ title: "Not saved", description: r.error, variant: "error" });
                return;
              }
              toast({ title: "Saved", variant: "success" });
              router.refresh();
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
