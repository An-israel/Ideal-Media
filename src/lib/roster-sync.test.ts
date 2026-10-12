import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { reconcileRoster, type ExistingAccount } from "./roster-sync";
import { parseMemberList } from "./member-list";
import { phoneKey } from "./phone";

/** Builds a list entry with a correctly derived phone key, as the parser would. */
const entry = (position: number, name: string, phone: string | null) => ({
  position,
  name,
  phone,
  phoneKey: phone ? phoneKey(phone) : null,
});

const LIST = parseMemberList(
  readFileSync(join(__dirname, "__fixtures__", "member-list.txt"), "utf8")
);

const acct = (p: Partial<ExistingAccount> & { id: string; fullName: string }): ExistingAccount => ({
  phone: null,
  whatsappNumber: null,
  roles: [],
  memberStatus: "active",
  accessRevoked: false,
  ...p,
});

describe("matching confidence", () => {
  it("matches on phone even when the name is written differently", () => {
    const plan = reconcileRoster(
      [entry(1, "Opara Chidumebi Elisheva", "7075061412")],
      [acct({ id: "a", fullName: "Elisheva Opara", phone: "07075061412" })]
    );
    expect(plan.keep).toHaveLength(1);
    expect(plan.keep[0].confidence).toBe("phone");
    expect(plan.revoke).toEqual([]);
  });

  it("matches an exact name when the phone is absent from the account", () => {
    const plan = reconcileRoster(
      [entry(1, "Kalu Victoria", "9153203880")],
      [acct({ id: "a", fullName: "Kalu Victoria" })]
    );
    expect(plan.keep[0].confidence).toBe("exact-name");
  });

  it("matches the same names in a different order", () => {
    const plan = reconcileRoster(
      [entry(1, "Kalu Victoria", "9153203880")],
      [acct({ id: "a", fullName: "Victoria Kalu" })]
    );
    expect(plan.keep[0].confidence).toBe("same-names");
  });

  it("never auto-matches a shortened name", () => {
    // "Owan Flourish" against "Owan Flourish Worma" is exactly the shape of a
    // wrong match, so it is a question, not a decision.
    const plan = reconcileRoster(
      [entry(54, "Owan Flourish", null)],
      [acct({ id: "a", fullName: "Owan Flourish Worma" })]
    );
    expect(plan.keep).toEqual([]);
    expect(plan.confirm).toHaveLength(1);
    expect(plan.confirm[0].options.map((o) => o.id)).toEqual(["a"]);
  });

  it("asks about an entry with no phone, even on an exact name", () => {
    const plan = reconcileRoster(
      [entry(60, "Victoria Omekaodinma", null)],
      [acct({ id: "a", fullName: "Victoria Omekaodinma" })]
    );
    expect(plan.keep).toEqual([]);
    expect(plan.confirm[0].reason).toMatch(/No phone number/);
  });

  it("asks when two accounts share a name", () => {
    const plan = reconcileRoster(
      [entry(1, "Esther Emmanuel", "8076877763")],
      [acct({ id: "a", fullName: "Esther Emmanuel" }), acct({ id: "b", fullName: "Esther Emmanuel" })]
    );
    expect(plan.confirm).toHaveLength(1);
    expect(plan.confirm[0].options).toHaveLength(2);
  });
});

describe("safety rules", () => {
  it("never lets two list entries claim the same account", () => {
    // Both spellings point at one person. Taking both would keep one entry and
    // leave the other looking like somebody who needs creating.
    const plan = reconcileRoster(
      [
        entry(38, "Owan Flourish Worma", "9160781869"),
        entry(54, "Owan Flourish", null),
      ],
      [acct({ id: "a", fullName: "Owan Flourish Worma", phone: "09160781869" })]
    );
    expect(plan.keep).toHaveLength(1);
    expect(plan.keep[0].listed.position).toBe(38);
    expect(plan.revoke).toEqual([]);
    // The duplicate becomes a question, never a silent second account.
    expect(plan.confirm.map((c) => c.listed.position)).toEqual([54]);
  });

  it("never auto-revokes an account that holds a role", () => {
    const plan = reconcileRoster(
      [],
      [
        acct({ id: "sec", fullName: "The Secretary", roles: ["secretary"] }),
        acct({ id: "led", fullName: "A Leader", roles: ["subunit_leader"] }),
        acct({ id: "sa", fullName: "An Admin", roles: ["super_admin"] }),
        acct({ id: "plain", fullName: "A Member" }),
      ]
    );
    expect(plan.revoke.map((a) => a.id)).toEqual(["plain"]);
    expect(plan.protectedFromRevoke.map((a) => a.id).sort()).toEqual(["led", "sa", "sec"]);
  });

  it("does not revoke an account that is still awaiting a decision", () => {
    // It is offered as an option in the confirm list, so revoking it in the
    // same run would answer the question by destroying one of the choices.
    const plan = reconcileRoster(
      [entry(1, "Owan Flourish", null)],
      [acct({ id: "a", fullName: "Owan Flourish Worma" })]
    );
    expect(plan.confirm).toHaveLength(1);
    expect(plan.revoke).toEqual([]);
  });

  it("leaves an already-revoked account alone", () => {
    const plan = reconcileRoster(
      [],
      [acct({ id: "old", fullName: "Gone Already", accessRevoked: true })]
    );
    expect(plan.revoke).toEqual([]);
    expect(plan.alreadyRevoked.map((a) => a.id)).toEqual(["old"]);
  });

  it("honours a skipped position", () => {
    const plan = reconcileRoster(
      [
        entry(38, "Owan Flourish Worma", "9160781869"),
        entry(54, "Owan Flourish", null),
      ],
      [acct({ id: "a", fullName: "Owan Flourish Worma", phone: "09160781869" })],
      { skipPositions: [54] }
    );
    expect(plan.confirm).toEqual([]);
    expect(plan.keep).toHaveLength(1);
  });
});

describe("the real list against a simulated site", () => {
  // Every listed member already has an account, matched by phone, plus two
  // people who left (the two from the October reports) and the secretary.
  const accounts: ExistingAccount[] = [
    ...LIST.members
      .filter((m) => m.phone)
      .map((m, i) =>
        acct({ id: `u${i}`, fullName: m.name, phone: m.phone, whatsappNumber: m.phone })
      ),
    acct({ id: "gone1", fullName: "Daniel Chukwuka Obi", phone: "08030000001" }),
    acct({ id: "gone2", fullName: "Ibe Chibuzo", phone: "08030000002" }),
    acct({ id: "sec", fullName: "Department Secretary", roles: ["secretary"] }),
  ];

  const plan = reconcileRoster(LIST.members, accounts, { skipPositions: [54] });

  it("keeps every listed member who has a phone number", () => {
    // 101 entries, minus the skipped duplicate (#54) and the 7 other entries
    // with no phone, which become questions rather than automatic keeps.
    expect(plan.keep).toHaveLength(93);
  });

  it("matches 92 of them by phone, and #13 by name because its number is a typo", () => {
    // 1806973270 is not a Nigerian mobile, so the parser refuses to use it as
    // a key. The name carries the match instead, which is the point of not
    // trusting a malformed number.
    const byPhone = plan.keep.filter((k) => k.confidence === "phone");
    expect(byPhone).toHaveLength(92);
    const rest = plan.keep.filter((k) => k.confidence !== "phone");
    expect(rest.map((k) => k.listed.position)).toEqual([13]);
    expect(rest[0].confidence).toBe("exact-name");
  });

  it("asks about the remaining phone-less entries rather than guessing", () => {
    expect(plan.confirm.map((c) => c.listed.position)).toEqual([46, 56, 59, 60, 71, 75, 101]);
  });

  it("revokes exactly the two people who are no longer with the unit", () => {
    expect(plan.revoke.map((a) => a.fullName)).toEqual([
      "Daniel Chukwuka Obi",
      "Ibe Chibuzo",
    ]);
  });

  it("protects the secretary, who is not on the members list", () => {
    expect(plan.protectedFromRevoke.map((a) => a.fullName)).toEqual(["Department Secretary"]);
  });

  it("accounts for every single person exactly once", () => {
    const touched =
      plan.keep.length +
      plan.revoke.length +
      plan.protectedFromRevoke.length +
      plan.alreadyRevoked.length +
      new Set(plan.confirm.flatMap((c) => c.options.map((o) => o.id))).size;
    expect(touched).toBe(accounts.length);
  });
});

describe("a member on the list with no account", () => {
  it("is queued for creation, not silently dropped", () => {
    const plan = reconcileRoster(
      [entry(1, "Brand New Person", "8012345678")],
      []
    );
    expect(plan.create.map((c) => c.name)).toEqual(["Brand New Person"]);
    expect(plan.keep).toEqual([]);
  });
});
