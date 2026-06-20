"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { addNewMember } from "./actions";

export function AddNewMemberButton({ subunits }: { subunits: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    whatsappNumber: "",
    phone: "",
    email: "",
    primarySubunitId: subunits[0]?.id ?? "",
    notes: "",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    if (!form.fullName.trim() || !form.primarySubunitId) {
      toast({ title: "Name and subunit are required", variant: "error" });
      return;
    }
    setLoading(true);
    try {
      await addNewMember(form);
      toast({ title: "New member added", description: "They're on the roster and the welfare board.", variant: "success" });
      setOpen(false);
      setForm({ fullName: "", whatsappNumber: "", phone: "", email: "", primarySubunitId: subunits[0]?.id ?? "", notes: "" });
      router.refresh();
    } catch (e) {
      toast({ title: "Could not add member", description: String(e), variant: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" />
        Add new member
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add a new member"
        description="They'll appear on the secretary's roster and here for follow-up."
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Full name</Label>
            <Input value={form.fullName} onChange={set("fullName")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>WhatsApp</Label>
              <Input value={form.whatsappNumber} onChange={set("whatsappNumber")} placeholder="+234…" />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={set("phone")} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Email (optional)</Label>
            <Input type="email" value={form.email} onChange={set("email")} />
          </div>
          <div className="space-y-2">
            <Label>Primary subunit</Label>
            <Select
              value={form.primarySubunitId}
              onChange={(e) => setForm((f) => ({ ...f, primarySubunitId: e.target.value }))}
            >
              {subunits.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea value={form.notes} onChange={set("notes")} />
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Tip: enter the WhatsApp number they&apos;ll sign up with — that&apos;s how the app
            links them when they create their own login.
          </p>
          <Button className="w-full" onClick={submit} disabled={loading || !form.fullName.trim()}>
            {loading ? "Adding…" : "Add member"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
