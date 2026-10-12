import { phoneKey } from "@/lib/phone";
import { normalizeMemberName, type ListedMember } from "@/lib/member-list";

/**
 * Works out what reconciling the site against the official members list would
 * do — without doing any of it.
 *
 * This decides who keeps access to the website, so the bias throughout is
 * towards asking rather than guessing. A confident match is one made on a
 * phone number, or on a name that matches exactly or as the same set of names
 * in a different order. Anything thinner — a shortened name, an entry with no
 * phone number at all, two people who could both be meant — is returned for a
 * human to confirm, never resolved automatically.
 *
 * Two safety rules are structural rather than advisory:
 *   - One account can only be claimed by one list entry, so two spellings of
 *     the same person cannot quietly consume two different members.
 *   - An account holding a role (secretary, welfare, leader, admin) is never
 *     put in the automatic revoke list, because the media members list is not
 *     a list of who runs the system, and locking out the secretary is a far
 *     worse outcome than leaving one extra account active.
 */

export interface ExistingAccount {
  id: string;
  fullName: string;
  phone: string | null;
  whatsappNumber: string | null;
  /** Roles from user_roles, excluding the plain 'member' role. */
  roles: string[];
  memberStatus: string;
  /** Already revoked in a previous run. */
  accessRevoked: boolean;
}

export type MatchConfidence =
  | "phone"
  | "exact-name"
  | "same-names"
  | "partial-name"
  | "ambiguous"
  | "none";

export interface KeepRow {
  listed: ListedMember;
  account: ExistingAccount;
  confidence: MatchConfidence;
}

export interface ConfirmRow {
  listed: ListedMember;
  /** Candidate accounts, best first. Empty when nothing plausible was found. */
  options: ExistingAccount[];
  reason: string;
}

export interface RosterPlan {
  /** Confidently matched — these keep access. */
  keep: KeepRow[];
  /** Needs a human decision before anything happens. */
  confirm: ConfirmRow[];
  /** On the list, no account found — would be created. */
  create: ListedMember[];
  /** On the site, not on the list — would lose access. */
  revoke: ExistingAccount[];
  /** On the site, not on the list, but holds a role — never auto-revoked. */
  protectedFromRevoke: ExistingAccount[];
  /** Already revoked and still not on the list; nothing to do. */
  alreadyRevoked: ExistingAccount[];
}

function tokens(name: string): Set<string> {
  const n = normalizeMemberName(name);
  return new Set(n ? n.split(" ") : []);
}

function tokenKey(name: string): string {
  return [...tokens(name)].sort().join(" ");
}

/**
 * The distinct phone keys an account can be found by.
 *
 * De-duplicated on purpose: most members have the same number in both `phone`
 * and `whatsapp_number`, and indexing the account twice under one key made it
 * look like two different accounts sharing a number — which sent nearly every
 * member to the "needs your decision" list instead of matching them.
 */
function accountPhoneKeys(a: ExistingAccount): string[] {
  const keys = [phoneKey(a.phone), phoneKey(a.whatsappNumber)].filter(Boolean) as string[];
  return [...new Set(keys)];
}

export interface ReconcileOptions {
  /** List positions to ignore, e.g. a duplicate the admin has resolved. */
  skipPositions?: number[];
}

export function reconcileRoster(
  listed: ListedMember[],
  accounts: ExistingAccount[],
  opts: ReconcileOptions = {}
): RosterPlan {
  const skip = new Set(opts.skipPositions ?? []);
  const entries = listed.filter((m) => !skip.has(m.position));

  const byPhone = new Map<string, ExistingAccount[]>();
  const byExact = new Map<string, ExistingAccount[]>();
  const byTokens = new Map<string, ExistingAccount[]>();
  for (const a of accounts) {
    for (const k of accountPhoneKeys(a)) {
      const bucket = byPhone.get(k) ?? [];
      // Guard the bucket too, so a future second source of numbers cannot
      // reintroduce the duplicate-account illusion.
      if (!bucket.some((x) => x.id === a.id)) byPhone.set(k, [...bucket, a]);
    }
    const e = normalizeMemberName(a.fullName);
    if (e) byExact.set(e, [...(byExact.get(e) ?? []), a]);
    const t = tokenKey(a.fullName);
    if (t) byTokens.set(t, [...(byTokens.get(t) ?? []), a]);
  }

  const keep: KeepRow[] = [];
  const confirm: ConfirmRow[] = [];
  const create: ListedMember[] = [];
  /** account id -> the list position that claimed it. */
  const claimed = new Map<string, number>();

  const take = (listedRow: ListedMember, account: ExistingAccount, confidence: MatchConfidence) => {
    claimed.set(account.id, listedRow.position);
    keep.push({ listed: listedRow, account, confidence });
  };

  const free = (list: ExistingAccount[] | undefined) =>
    (list ?? []).filter((a) => !claimed.has(a.id));

  // Phone first, in its own pass. A number is the only identifier here that is
  // actually unique, so every phone match must be settled before any name
  // match can claim an account out from under one.
  const unresolved: ListedMember[] = [];
  for (const m of entries) {
    if (!m.phoneKey) {
      unresolved.push(m);
      continue;
    }
    const hits = free(byPhone.get(m.phoneKey));
    if (hits.length === 1) take(m, hits[0], "phone");
    else if (hits.length > 1) {
      confirm.push({
        listed: m,
        options: hits,
        reason: "More than one account has this phone number.",
      });
    } else unresolved.push(m);
  }

  for (const m of unresolved) {
    const exact = free(byExact.get(normalizeMemberName(m.name)));
    if (exact.length === 1) {
      // An entry with no phone number is confirmed by a human even on an exact
      // name, because a name alone cannot separate two people who share one.
      if (!m.phone) {
        confirm.push({
          listed: m,
          options: exact,
          reason: "No phone number on the list, so this is a name-only match.",
        });
      } else {
        take(m, exact[0], "exact-name");
      }
      continue;
    }
    if (exact.length > 1) {
      confirm.push({ listed: m, options: exact, reason: "Several accounts share this name." });
      continue;
    }

    const same = free(byTokens.get(tokenKey(m.name)));
    if (same.length === 1) {
      if (!m.phone) {
        confirm.push({
          listed: m,
          options: same,
          reason: "No phone number on the list, so this is a name-only match.",
        });
      } else {
        take(m, same[0], "same-names");
      }
      continue;
    }
    if (same.length > 1) {
      confirm.push({ listed: m, options: same, reason: "Several accounts share these names." });
      continue;
    }

    // A shortened or extended form of a name. Never automatic: it is the shape
    // a wrong match takes.
    const want = tokens(m.name);
    const partial = accounts.filter((a) => {
      if (claimed.has(a.id)) return false;
      const have = tokens(a.fullName);
      if (have.size === 0 || want.size === 0) return false;
      return (
        [...want].every((t) => have.has(t)) || [...have].every((t) => want.has(t))
      );
    });

    if (partial.length > 0 && want.size >= 2) {
      confirm.push({
        listed: m,
        options: partial,
        reason:
          partial.length === 1
            ? "The names are close but not identical."
            : "Several accounts could be this person.",
      });
      continue;
    }

    if (!m.phone) {
      // No phone number AND nothing matched. Creating an account here is how a
      // duplicate gets made: "Owan Flourish" would become a second record
      // beside the existing "Owan Flourish Worma", splitting one person's
      // attendance across two people. Ask instead.
      confirm.push({
        listed: m,
        options: [],
        reason:
          "No phone number, and no account matched this name. Point it at an existing member or create a new one.",
      });
      continue;
    }

    create.push(m);
  }

  const revoke: ExistingAccount[] = [];
  const protectedFromRevoke: ExistingAccount[] = [];
  const alreadyRevoked: ExistingAccount[] = [];

  // An account offered as an option in the confirm list is not yet decided, so
  // it must not also appear as something to revoke.
  const pending = new Set(confirm.flatMap((c) => c.options.map((o) => o.id)));

  for (const a of accounts) {
    if (claimed.has(a.id) || pending.has(a.id)) continue;
    if (a.accessRevoked) alreadyRevoked.push(a);
    else if (a.roles.length > 0) protectedFromRevoke.push(a);
    else revoke.push(a);
  }

  const byName = (x: { fullName: string }, y: { fullName: string }) =>
    x.fullName.localeCompare(y.fullName);
  revoke.sort(byName);
  protectedFromRevoke.sort(byName);
  alreadyRevoked.sort(byName);
  create.sort((a, b) => a.position - b.position);
  confirm.sort((a, b) => a.listed.position - b.listed.position);

  return { keep, confirm, create, revoke, protectedFromRevoke, alreadyRevoked };
}
