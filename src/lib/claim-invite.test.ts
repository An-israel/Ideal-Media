import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

/**
 * A tiny in-memory stand-in for the two tables the claim links touch. Enough
 * of the query builder to run the real code: select/insert/update/delete with
 * eq, is and maybeSingle.
 */
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;

function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "update" | "delete" = "select";
  let patch: Row = {};
  const rows = () => tables[table].filter((r) => filters.every((f) => f(r)));
  const b = {
    select() {
      return b;
    },
    eq(c: string, v: unknown) {
      filters.push((r) => r[c] === v);
      return b;
    },
    is(c: string, v: unknown) {
      filters.push((r) => (r[c] ?? null) === v);
      return b;
    },
    update(p: Row) {
      op = "update";
      patch = p;
      return b;
    },
    delete() {
      op = "delete";
      return b;
    },
    async maybeSingle() {
      return { data: rows()[0] ?? null, error: null };
    },
    then(resolve: (v: { data: Row[] | null; error: null }) => unknown) {
      if (op === "delete") {
        const gone = new Set(rows());
        tables[table] = tables[table].filter((r) => !gone.has(r));
        return Promise.resolve({ data: [...gone], error: null }).then(resolve);
      }
      if (op === "update") {
        const hit = rows();
        hit.forEach((r) => Object.assign(r, patch));
        return Promise.resolve({ data: hit, error: null }).then(resolve);
      }
      return Promise.resolve({ data: rows(), error: null }).then(resolve);
    },
  };
  return b;
}

const fake = {
  from: (t: string) => ({
    ...query(t),
    insert: async (row: Row) => {
      tables[t].push({ id: `id-${tables[t].length + 1}`, used_at: null, ...row });
      return { error: null };
    },
  }),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake }));
const { createClaimInvite, resolveClaimInvite, consumeClaimInvite } = await import("./claim-invite");

beforeEach(() => {
  tables = {
    member_claim_invites: [],
    profiles: [
      { id: "onyinye", full_name: "Onyinye", claimed: false },
      { id: "done", full_name: "Already Joined", claimed: true },
    ],
  };
});

describe("claim links", () => {
  it("never stores the token itself, only its hash", async () => {
    const token = await createClaimInvite("onyinye", "secretary");
    const stored = tables.member_claim_invites[0];
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("resolves a fresh token to the right member", async () => {
    const token = await createClaimInvite("onyinye", "secretary");
    const target = await resolveClaimInvite(token);
    expect(target).toMatchObject({ userId: "onyinye", fullName: "Onyinye" });
  });

  it("works once", async () => {
    const token = await createClaimInvite("onyinye", "secretary");
    const target = (await resolveClaimInvite(token))!;
    expect(await consumeClaimInvite(target.inviteId)).toBe(true);
    // A second person opening the same link, or the same person twice.
    expect(await consumeClaimInvite(target.inviteId)).toBe(false);
    expect(await resolveClaimInvite(token)).toBeNull();
  });

  it("cancels the old link when a new one is made", async () => {
    // So a link sent to the wrong number is killed by sending another.
    const first = await createClaimInvite("onyinye", "secretary");
    const second = await createClaimInvite("onyinye", "secretary");
    expect(await resolveClaimInvite(first)).toBeNull();
    expect(await resolveClaimInvite(second)).not.toBeNull();
  });

  it("refuses an expired link", async () => {
    const token = await createClaimInvite("onyinye", "secretary");
    tables.member_claim_invites[0].expires_at = new Date(Date.now() - 1000).toISOString();
    expect(await resolveClaimInvite(token)).toBeNull();
  });

  it("refuses a link to a record that has since been claimed another way", async () => {
    const token = await createClaimInvite("onyinye", "secretary");
    tables.profiles[0].claimed = true;
    expect(await resolveClaimInvite(token)).toBeNull();
  });

  it("refuses guesses and junk without touching the table", async () => {
    expect(await resolveClaimInvite("")).toBeNull();
    expect(await resolveClaimInvite("short")).toBeNull();
    expect(await resolveClaimInvite("x".repeat(500))).toBeNull();
    expect(await resolveClaimInvite("a-plausible-looking-but-unknown-token")).toBeNull();
  });
});
