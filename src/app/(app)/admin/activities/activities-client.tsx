"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import { createActivity, updateActivity, setMissedThreshold } from "../actions";

type Activity = {
  id: string;
  name: string;
  day_of_week: string;
  time_of_day: string;
  is_attendance_signal: boolean;
};

export function ActivitiesClient({
  activities,
  threshold,
}: {
  activities: Activity[];
  threshold: number;
}) {
  const router = useRouter();
  const [t, setT] = useState(threshold);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", day: "", time: "", isSignal: false });

  async function saveThreshold() {
    setBusy(true);
    try {
      await setMissedThreshold(t);
      toast({ title: "Threshold saved", variant: "success" });
    } catch (e) {
      toast({ title: "Save failed", description: String(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await createActivity(form);
      setForm({ name: "", day: "", time: "", isSignal: false });
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
        <CardHeader>
          <CardTitle className="text-base">Missed-service threshold</CardTitle>
        </CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="thr">Consecutive missed Sundays before a welfare flag</Label>
            <Input
              id="thr"
              type="number"
              min={1}
              value={t}
              onChange={(e) => setT(Number(e.target.value))}
              className="w-24"
            />
          </div>
          <Button onClick={saveThreshold} disabled={busy} variant="secondary">
            Save
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="divide-y divide-[var(--border)] p-0">
          {activities.map((a) => (
            <ActivityRow key={a.id} activity={a} onSaved={() => router.refresh()} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add activity</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="Day" value={form.day} onChange={(v) => setForm({ ...form, day: v })} />
          <Field label="Time" value={form.time} onChange={(v) => setForm({ ...form, time: v })} />
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={form.isSignal}
              onChange={(e) => setForm({ ...form, isSignal: e.target.checked })}
            />
            Attendance signal
          </label>
          <Button onClick={add} disabled={busy || !form.name.trim()}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ActivityRow({ activity, onSaved }: { activity: Activity; onSaved: () => void }) {
  const [name, setName] = useState(activity.name);
  const [day, setDay] = useState(activity.day_of_week);
  const [time, setTime] = useState(activity.time_of_day);
  const [isSignal, setIsSignal] = useState(activity.is_attendance_signal);
  const [busy, setBusy] = useState(false);
  const dirty =
    name !== activity.name ||
    day !== activity.day_of_week ||
    time !== activity.time_of_day ||
    isSignal !== activity.is_attendance_signal;

  async function save() {
    setBusy(true);
    try {
      await updateActivity(activity.id, { name, day, time, isSignal });
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
      <Input value={name} onChange={(e) => setName(e.target.value)} className="max-w-[12rem]" />
      <Input value={day} onChange={(e) => setDay(e.target.value)} className="w-28" placeholder="Day" />
      <Input value={time} onChange={(e) => setTime(e.target.value)} className="w-28" placeholder="Time" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isSignal} onChange={(e) => setIsSignal(e.target.checked)} />
        signal
      </label>
      {dirty ? (
        <Button size="sm" onClick={save} disabled={busy}>
          Save
        </Button>
      ) : (
        activity.is_attendance_signal && <Badge variant="default">signal</Badge>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="w-32" />
    </div>
  );
}
