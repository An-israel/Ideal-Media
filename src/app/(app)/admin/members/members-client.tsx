"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { MEMBER_STATUSES } from "@/lib/constants";
import { adminSetMemberStatus } from "../actions";
import type { MemberStatus } from "@/lib/database.types";

export type AdminMemberRow = {
  id: string;
  name: string;
  email: string;
  status: MemberStatus;
  subunit: string;
};

export function MembersClient({ rows }: { rows: AdminMemberRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.name.toLowerCase().includes(query.toLowerCase()) ||
          r.email.toLowerCase().includes(query.toLowerCase())
      ),
    [rows, query]
  );

  async function change(id: string, status: MemberStatus) {
    try {
      await adminSetMemberStatus(id, status);
      toast({ title: "Status updated", variant: "success" });
      router.refresh();
    } catch (e) {
      toast({ title: "Update failed", description: String(e), variant: "error" });
    }
  }

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search by name or email…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-xs"
      />
      <Card>
        <CardContent className="divide-y divide-[var(--border)] p-0">
          {filtered.map((r) => (
            <div
              key={r.id}
              className="grid grid-cols-[1fr_auto] items-center gap-3 px-5 py-3 sm:grid-cols-[1.5fr_1.5fr_1fr_10rem]"
            >
              <Link href={`/leader/members/${r.id}`} className="min-w-0 hover:underline">
                <p className="truncate text-sm font-medium">{r.name}</p>
              </Link>
              <span className="hidden truncate text-sm text-[var(--text-muted)] sm:block">{r.email}</span>
              <span className="hidden truncate text-sm text-[var(--text-muted)] sm:block">{r.subunit}</span>
              <Select
                value={r.status}
                onChange={(e) => change(r.id, e.target.value as MemberStatus)}
                className="h-9"
              >
                {MEMBER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="px-5 py-10 text-center text-sm text-[var(--text-muted)]">No members match.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
