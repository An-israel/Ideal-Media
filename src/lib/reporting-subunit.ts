/**
 * Decides which ONE subunit reports a person's attendance.
 *
 * The department total is the sum of the subunits, so every person must land on
 * exactly one list. Appearing twice inflates the roll and double-counts an
 * absence; appearing nowhere makes someone invisible to attendance entirely.
 *
 * The rule, in order:
 *
 *   1. Their PRIMARY subunit. A unique index guarantees at most one, and this
 *      is the normal case.
 *   2. Otherwise, a subunit they LEAD. Promoting someone to lead a subunit they
 *      weren't already in adds them as a *secondary* member, so a leader could
 *      end up absent from the very list they are responsible for filling in.
 *   3. Otherwise nobody reports them, and they need a primary subunit setting
 *      on the roster — surfaced rather than silently dropped.
 *
 * Note what rule 2 does NOT do: a leader who already has a primary subunit
 * elsewhere stays reported by that primary one. Adding them to the subunit they
 * lead as well would count them twice, which is the bug this ordering exists to
 * prevent.
 */

export interface MembershipRow {
  subunitId: string;
  membershipType: "primary" | "secondary";
  roleInSubunit: "member" | "leader";
}

export function resolveReportingSubunit(memberships: readonly MembershipRow[]): string | null {
  const primary = memberships.find((m) => m.membershipType === "primary");
  if (primary) return primary.subunitId;

  // Sorted so the choice is stable across requests when somebody leads more
  // than one subunit — an unstable pick would move a person between lists
  // between page loads.
  const led = memberships
    .filter((m) => m.roleInSubunit === "leader")
    .map((m) => m.subunitId)
    .sort();
  return led[0] ?? null;
}

/** Resolves a whole batch, keyed by user. */
export function resolveReportingSubunits(
  rows: readonly (MembershipRow & { userId: string })[]
): Map<string, string> {
  const byUser = new Map<string, MembershipRow[]>();
  for (const r of rows) {
    byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  }
  const out = new Map<string, string>();
  for (const [userId, memberships] of byUser) {
    const subunitId = resolveReportingSubunit(memberships);
    if (subunitId) out.set(userId, subunitId);
  }
  return out;
}
