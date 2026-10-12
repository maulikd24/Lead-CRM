import { describe, expect, it } from "vitest";

import { planReversal, accrualStates, clawbackStates, netAccruedInMonth, planApprove, planConfirmClawback, planPrepare, planWaiveClawback, statementCandidates, stillClean, type LedgerEntry } from "./ledger";

let n = 0;
const e = (over: Partial<LedgerEntry> & Pick<LedgerEntry, "kind">): LedgerEntry => ({ id: `e${++n}`, referrerId: "R", amountPaise: 10000, refEntryId: null, flags: [], periodMonth: "2027-01", ...over });
const accrual = (over: Partial<LedgerEntry> = {}) => e({ kind: "ACCRUED", ...over });
const claw = (a: LedgerEntry, over: Partial<LedgerEntry> = {}) => e({ kind: "CLAWBACK", refEntryId: a.id, amountPaise: -a.amountPaise, periodMonth: "2027-02", flags: ["CLAWBACK_KYC_REVOKED"], ...over });
const follow = (kind: LedgerEntry["kind"], ref: LedgerEntry, over: Partial<LedgerEntry> = {}) => e({ kind, refEntryId: ref.id, amountPaise: ref.amountPaise, periodMonth: "2027-02", ...over });
const admin = { id: "u-admin", role: "ADMIN" as const };
const fin = { id: "u-fin", role: "FINANCE" as const };

describe("accrual state with a clawback", () => {
  it("a clawback makes the accrual CLAWED_BACK, whatever stage it had reached", () => {
    const fresh = accrual();
    const reviewed = accrual({ flags: ["VELOCITY"] });
    const approved = accrual();
    const paid = accrual();
    const all = [fresh, reviewed, approved, paid, claw(fresh), claw(reviewed), claw(approved), claw(paid), follow("APPROVED", approved), follow("APPROVED", paid), follow("PAID_MARKED", paid)];
    const s = accrualStates(all);
    expect([fresh, reviewed, approved, paid].map((a) => s.get(a.id))).toEqual(["CLAWED_BACK", "CLAWED_BACK", "CLAWED_BACK", "CLAWED_BACK"]);
  });
  it("waiving the clawback puts the accrual back where it was", () => {
    const fresh = accrual();
    const paid = accrual();
    const c1 = claw(fresh);
    const c2 = claw(paid);
    const s = accrualStates([fresh, paid, c1, c2, follow("APPROVED", paid), follow("PAID_MARKED", paid), e({ kind: "CLAWBACK_WAIVED", refEntryId: c1.id, amountPaise: 10000 }), e({ kind: "CLAWBACK_WAIVED", refEntryId: c2.id, amountPaise: 10000 })]);
    expect([s.get(fresh.id), s.get(paid.id)]).toEqual(["ACCRUED", "PAID"]);
  });
  it("an accrual that was reversed stays REVERSED (nothing to claw back)", () => {
    const a = accrual();
    expect(accrualStates([a, follow("REVERSED", a), claw(a)]).get(a.id)).toBe("REVERSED");
  });
  it("a clawed-back reward still counts towards the monthly cap (taking it back must not make room for another)", () => {
    const a = accrual({ amountPaise: 300 });
    expect(netAccruedInMonth([a, claw(a)], "R", "2027-01")).toBe(300);
  });
});

describe("clawbackStates", () => {
  it("is NEEDS_REVIEW until someone confirms it, then CONFIRMED; a waiver makes it WAIVED", () => {
    const a = accrual();
    const c1 = claw(a);
    const c2 = claw(a);
    const c3 = claw(a);
    const s = clawbackStates([a, c1, c2, c3, follow("REVIEW_CLEARED", c2, { amountPaise: 0 }), follow("CLAWBACK_WAIVED", c3)]);
    expect([s.get(c1.id), s.get(c2.id), s.get(c3.id)]).toEqual(["NEEDS_REVIEW", "CONFIRMED", "WAIVED"]);
  });
  it("a waiver beats a confirmation", () => {
    const a = accrual();
    const c = claw(a);
    expect(clawbackStates([a, c, follow("REVIEW_CLEARED", c, { amountPaise: 0 }), follow("CLAWBACK_WAIVED", c)]).get(c.id)).toBe("WAIVED");
  });
});

describe("statements and clawbacks", () => {
  it("a clawback of a reward that was already approved is a negative line on the next statement", () => {
    const old = accrual({ amountPaise: 10000, periodMonth: "2027-01" });
    const fresh = accrual({ amountPaise: 50000, periodMonth: "2027-02" });
    const c = claw(old, { periodMonth: "2027-02" });
    const ledger = [old, fresh, follow("APPROVED", old), follow("PAID_MARKED", old), c];
    const lines = statementCandidates(ledger, "R", "2027-02");
    expect(lines.map((l) => [l.kind, l.amountPaise]).sort()).toEqual([["ACCRUED", 50000], ["CLAWBACK", -10000]]);
    const plan = planPrepare({ actor: admin, existing: null, candidates: lines });
    expect(plan).toMatchObject({ ok: true, totalPaise: 40000 });
  });
  it("a clawback of a reward that never reached a statement simply removes that reward: no negative line, nothing to pay", () => {
    const a = accrual();
    const ledger = [a, claw(a)];
    expect(statementCandidates(ledger, "R", "2027-02")).toEqual([]);
  });
  it("a waived clawback is not a line; a clawback already taken by an approved statement is not a line again", () => {
    const old = accrual();
    const waived = claw(old);
    const taken = claw(accrual());
    const base = [old, follow("APPROVED", old), waived, follow("CLAWBACK_WAIVED", waived)];
    expect(statementCandidates(base, "R", "2027-02")).toEqual([]);
    const a2 = accrual();
    const c2 = claw(a2);
    expect(statementCandidates([a2, follow("APPROVED", a2), c2, follow("APPROVED", c2, { amountPaise: -10000 })], "R", "2027-02")).toEqual([]);
    expect(taken).toBeTruthy();
  });
  it("a clawback recorded for a later month waits for that month's statement", () => {
    const old = accrual();
    const later = claw(old, { periodMonth: "2027-03" });
    expect(statementCandidates([old, follow("APPROVED", old), later], "R", "2027-02")).toEqual([]);
    expect(statementCandidates([old, follow("APPROVED", old), later], "R", "2027-03")).toHaveLength(1);
  });
  it("clawbacks are another referrer's business only for that referrer", () => {
    const old = accrual({ referrerId: "Z" });
    expect(statementCandidates([old, follow("APPROVED", old, { referrerId: "Z" }), claw(old, { referrerId: "Z" })], "R", "2027-02")).toEqual([]);
  });
  it("when the recoveries outweigh the rewards nothing can be prepared: the balance carries forward and is explained", () => {
    const old = accrual({ amountPaise: 90000 });
    const fresh = accrual({ amountPaise: 10000, periodMonth: "2027-02" });
    const ledger = [old, fresh, follow("APPROVED", old), claw(old, { periodMonth: "2027-02" })];
    const plan = planPrepare({ actor: admin, existing: null, candidates: statementCandidates(ledger, "R", "2027-02") });
    expect(plan).toMatchObject({ ok: false, error: expect.stringMatching(/carries forward|carry forward/i) });
  });
  it("a statement with a negative total cannot be approved", () => {
    expect(planApprove({ statement: { status: "PREPARED", preparedById: "u1", totalPaise: -1 }, actor: fin })).toMatchObject({ ok: false });
  });
});

describe("stillClean (the approval re-check)", () => {
  it("is true while every line is still a clean accrual or a live, untaken clawback", () => {
    const old = accrual();
    const fresh = accrual({ periodMonth: "2027-02" });
    const c = claw(old);
    const ledger = [old, follow("APPROVED", old), fresh, c];
    expect(stillClean([fresh, c], ledger)).toBe(true);
  });
  it("is false when a line's accrual has since been clawed back, reversed or reviewed again", () => {
    const fresh = accrual();
    expect(stillClean([fresh], [fresh, claw(fresh)])).toBe(false);
    expect(stillClean([fresh], [fresh, follow("REVERSED", fresh)])).toBe(false);
  });
  it("is false when a clawback line was waived after the statement was prepared", () => {
    const old = accrual();
    const c = claw(old);
    expect(stillClean([c], [old, follow("APPROVED", old), c, follow("CLAWBACK_WAIVED", c)])).toBe(false);
  });
});

describe("confirming and waiving a clawback", () => {
  it("only Admin or Finance, only while it needs review, with a real note", () => {
    expect(planConfirmClawback({ state: "NEEDS_REVIEW", actor: fin, note: "Checked: KYC really was revoked" })).toMatchObject({ ok: true });
    expect(planConfirmClawback({ state: "NEEDS_REVIEW", actor: { id: "m", role: "MANAGER" }, note: "Checked: KYC really was revoked" })).toMatchObject({ ok: false });
    expect(planConfirmClawback({ state: "CONFIRMED", actor: fin, note: "Checked: KYC really was revoked" })).toMatchObject({ ok: false });
    expect(planConfirmClawback({ state: "WAIVED", actor: fin, note: "Checked: KYC really was revoked" })).toMatchObject({ ok: false });
    expect(planConfirmClawback({ state: "NEEDS_REVIEW", actor: fin, note: "ok" })).toMatchObject({ ok: false });
  });
  it("a waiver needs a reason, is refused once an approved statement has taken the clawback, and cannot be done twice", () => {
    expect(planWaiveClawback({ state: "NEEDS_REVIEW", taken: false, actor: admin, reason: "KYC was re-approved the next day" })).toMatchObject({ ok: true });
    expect(planWaiveClawback({ state: "CONFIRMED", taken: false, actor: admin, reason: "KYC was re-approved the next day" })).toMatchObject({ ok: true });
    expect(planWaiveClawback({ state: "CONFIRMED", taken: true, actor: admin, reason: "KYC was re-approved the next day" })).toMatchObject({ ok: false, error: expect.stringMatching(/approved statement/i) });
    expect(planWaiveClawback({ state: "WAIVED", taken: false, actor: admin, reason: "KYC was re-approved the next day" })).toMatchObject({ ok: false });
    expect(planWaiveClawback({ state: "NEEDS_REVIEW", taken: false, actor: admin, reason: "no" })).toMatchObject({ ok: false });
    expect(planWaiveClawback({ state: "NEEDS_REVIEW", taken: false, actor: { id: "r", role: "RM" }, reason: "KYC was re-approved the next day" })).toMatchObject({ ok: false });
  });
});

describe("reversing a reward that has been taken back", () => {
  it("says so, rather than blaming an approved statement", () => {
    expect(planReversal({ state: "CLAWED_BACK", actor: admin, reason: "duplicate" })).toMatchObject({ ok: false, error: expect.stringMatching(/taken back/i) });
  });
});
