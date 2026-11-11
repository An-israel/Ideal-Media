"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, Loader2 } from "lucide-react";
import { moveToSubunit } from "./actions";
import type { Suggestion } from "@/lib/subunit-suggestions";
import { toast } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Suggested units for members who have none, for the secretary to confirm.
 *
 * Every row is ticked to begin with and can be un-ticked or pointed at a
 * different unit: the suggestion is evidence, not a decision, and the reason
 * for each one is on the row so it can be checked against what the secretary
 * actually knows.
 */
export function SuggestedUnits({
  suggestions,
  subunits,
}: {
  suggestions: Suggestion[];
  subunits: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [chosen, setChosen] = useState<Record<string, string>>(
    Object.fromEntries(suggestions.map((s) => [s.userId, s.subunitId]))
  );
  const [ticked, setTicked] = useState<Set<string>>(new Set(suggestions.map((s) => s.userId)));

  if (suggestions.length === 0) return null;

  const toggle = (id: string) =>
    setTicked((t) => {
      const next = new Set(t);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = () =>
    start(async () => {
      // One call per unit, since that is what the action takes.
      const groups = new Map<string, string[]>();
      for (const s of suggestions) {
        if (!ticked.has(s.userId)) continue;
        const unit = chosen[s.userId];
        if (!unit) continue;
        groups.set(unit, [...(groups.get(unit) ?? []), s.userId]);
      }
      let placed = 0;
      try {
        for (const [subunitId, userIds] of groups) {
          const res = await moveToSubunit(userIds, subunitId);
          placed += res.moved;
        }
        toast({ title: `${placed} member${placed === 1 ? "" : "s"} placed`, variant: "success" });
      } catch (e) {
        toast({
          title: placed > 0 ? `${placed} placed, then it stopped` : "Nobody was placed",
          description: e instanceof Error ? e.message : String(e),
          variant: "error",
        });
      }
      router.refresh();
    });

  return (
    <Card className="mb-6">
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="h-4 w-4" /> Suggested subunits ({suggestions.length})
        </CardTitle>
        <p className="text-sm text-[var(--text-muted)]">
          These members have no subunit, but the subunit sheets or their course history point to
          one. Check each against what you know, change or un-tick any that are wrong, then place
          them.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 p-0 pb-5">
        <div className="max-h-96 divide-y divide-[var(--border)] overflow-y-auto border-y border-[var(--border)]">
          {suggestions.map((s) => (
            <div key={s.userId} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                checked={ticked.has(s.userId)}
                onChange={() => toggle(s.userId)}
                aria-label={`Place ${s.fullName}`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.fullName}</p>
                <p className="truncate text-xs text-[var(--text-muted)]">{s.evidence}</p>
              </div>
              <Select
                value={chosen[s.userId] ?? ""}
                onChange={(e) => setChosen((c) => ({ ...c, [s.userId]: e.target.value }))}
                className="h-9 w-44"
                aria-label={`Subunit for ${s.fullName}`}
              >
                {subunits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
        <div className="px-5">
          <Button onClick={apply} disabled={pending || ticked.size === 0}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Place {ticked.size} member{ticked.size === 1 ? "" : "s"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
