"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { createCourse } from "./actions";
import { toast } from "@/components/ui/toaster";

export function CreateCourseButton({ subunits }: { subunits: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subunitId, setSubunitId] = useState(subunits[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!title.trim() || !subunitId) return;
    setLoading(true);
    try {
      const id = await createCourse({ subunitId, title, description });
      setOpen(false);
      setTitle("");
      setDescription("");
      router.push(`/leader/courses/${id}`);
    } catch (e) {
      toast({ title: "Could not create course", description: String(e), variant: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={subunits.length === 0}>
        <Plus className="h-4 w-4" />
        New course
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Create a course">
        <div className="space-y-4">
          {subunits.length > 1 && (
            <div className="space-y-2">
              <Label>Subunit</Label>
              <Select value={subunitId} onChange={(e) => setSubunitId(e.target.value)}>
                {subunits.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <Button onClick={submit} disabled={loading || !title.trim()} className="w-full">
            {loading ? "Creating…" : "Create course"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
