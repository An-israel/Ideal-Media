"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { grantRole, revokeRole, setSubunitLeader } from "../actions";
import type { Role } from "@/lib/database.types";

export type MemberRoles = {
  id: string;
  name: string;
  roles: Role[];
  ledSubunitIds: string[];
};

const ASSIGNABLE: { role: Role; label: string }[] = [
  { role: "secretary", label: "Secretary" },
  { role: "welfare", label: "Welfare" },
  { role: "super_admin", label: "Super admin" },
];

export function RolesClient({
  members,
  subunits,
}: {
  members: MemberRoles[];
  subunits: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<MemberRoles | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(
    () => members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase())),
    [members, query]
  );

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      toast({ title: "Action failed", description: String(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search members…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-xs"
      />
      <Card>
        <CardContent className="divide-y divide-[var(--border)] p-0">
          {filtered.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{m.name}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.roles.length === 0 && <span className="text-xs text-[var(--text-muted)]">member</span>}
                  {m.roles.map((r) => (
                    <Badge key={r} variant="neutral">{r.replace("_", " ")}</Badge>
                  ))}
                  {m.ledSubunitIds.length > 0 && (
                    <Badge variant="default">leads {m.ledSubunitIds.length}</Badge>
                  )}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setEditing(m)}>
                Manage
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.name}>
        {editing && (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium">Roles</p>
              <div className="flex flex-wrap gap-2">
                {ASSIGNABLE.map(({ role, label }) => {
                  const has = editing.roles.includes(role);
                  return (
                    <button
                      key={role}
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          if (has) await revokeRole(editing.id, role);
                          else await grantRole(editing.id, role);
                          setEditing({
                            ...editing,
                            roles: has
                              ? editing.roles.filter((r) => r !== role)
                              : [...editing.roles, role],
                          });
                        })
                      }
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-sm transition-colors",
                        has
                          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                          : "border-[var(--border)] hover:bg-[var(--bg)]"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Subunit leadership</p>
              <p className="text-xs text-[var(--text-muted)]">
                Marking a subunit grants the subunit-leader role and sets this person as its leader.
              </p>
              <div className="grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto">
                {subunits.map((s) => {
                  const leads = editing.ledSubunitIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await setSubunitLeader(editing.id, s.id, !leads);
                          if (!leads && !editing.roles.includes("subunit_leader")) {
                            await grantRole(editing.id, "subunit_leader");
                          }
                          setEditing({
                            ...editing,
                            ledSubunitIds: leads
                              ? editing.ledSubunitIds.filter((x) => x !== s.id)
                              : [...editing.ledSubunitIds, s.id],
                            roles:
                              !leads && !editing.roles.includes("subunit_leader")
                                ? [...editing.roles, "subunit_leader"]
                                : editing.roles,
                          });
                        })
                      }
                      className={cn(
                        "flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                        leads
                          ? "border-[var(--accent)] bg-[var(--accent)]/8 text-[var(--accent)]"
                          : "border-[var(--border)] hover:bg-[var(--bg)]"
                      )}
                    >
                      {s.name}
                      {leads && <span className="text-xs">leader</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
