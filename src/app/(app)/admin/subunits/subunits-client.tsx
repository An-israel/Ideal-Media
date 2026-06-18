"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import { createSubunit, updateSubunit } from "../actions";
import type { SubunitCategory } from "@/lib/database.types";

type Subunit = { id: string; name: string; category: SubunitCategory };

export function SubunitsClient({ subunits }: { subunits: Subunit[] }) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<SubunitCategory>("primary");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await createSubunit(newName, newCategory);
      setNewName("");
      router.refresh();
    } catch (e) {
      toast({ title: "Could not add", description: String(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="flex-1 space-y-1">
            <label className="text-xs text-[var(--text-muted)]">New subunit name</label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <Select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as SubunitCategory)}
            className="w-36"
          >
            <option value="primary">primary</option>
            <option value="secondary">secondary</option>
          </Select>
          <Button onClick={add} disabled={busy || !newName.trim()}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="divide-y divide-[var(--border)] p-0">
          {subunits.map((s) => (
            <SubunitRow key={s.id} subunit={s} onSaved={() => router.refresh()} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function SubunitRow({ subunit, onSaved }: { subunit: Subunit; onSaved: () => void }) {
  const [name, setName] = useState(subunit.name);
  const [category, setCategory] = useState<SubunitCategory>(subunit.category);
  const [busy, setBusy] = useState(false);
  const dirty = name !== subunit.name || category !== subunit.category;

  async function save() {
    setBusy(true);
    try {
      await updateSubunit(subunit.id, name, category);
      toast({ title: "Saved", variant: "success" });
      onSaved();
    } catch (e) {
      toast({ title: "Save failed", description: String(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3">
      <Input value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
      <Select
        value={category}
        onChange={(e) => setCategory(e.target.value as SubunitCategory)}
        className="w-36"
      >
        <option value="primary">primary</option>
        <option value="secondary">secondary</option>
      </Select>
      {dirty ? (
        <Button size="sm" onClick={save} disabled={busy}>
          Save
        </Button>
      ) : (
        <Badge variant="neutral">{category}</Badge>
      )}
    </div>
  );
}
