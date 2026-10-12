import { describe, expect, it } from "vitest";

import { accrualStates, netAccruedInMonth, planApprove, planClearReview, planMarkPaid, planPrepare, planReversal, statementCandidates, type LedgerEntry, type StatementSnapshot } from "./ledger";

let n = 0;
const e = (over: Partial<LedgerEntry> & Pick<LedgerEntry, "kind">): LedgerEntry => ({ id: `e${++n}`, referrerId: "R", amountPaise: 10000, refEntryId: null, flags: [], periodMonth: "2027-01", ...over });
const admin = { id: "u-admin", role: "ADMIN" as const };
const fin = { id: "u-fin", role: "FINANCE" as const };

describe("accrualStates (append-only: state is derived from later entries)", () => {
  it("a plain accrual is ACCRUED; a flagged one needs review until cleared", () => {
    const a = e({ kind: "ACCRUED" });
    const f = e({ kind: "ACCRUED", flags: ["VELOCITY"] });
    const states = accrualStates([a, f]);
    expect(states.get(a.id)).toBe("ACCRUED");
    expect(states.get(f.id)).toBe("NEEDS_REVIEW");
    const cleared = accrualStates([a, f, e({ kind: "REVIEW_CLEARED", refEntryId: f.id, amountPaise: 0 })]);
    expect(cleared.get(f.id)).toBe("ACCRUED");
  });
  it("follows reversal, approval and paid markers", () => {
    const a = e({ kind: "ACCRUED" });
    const b = e({ kind: "ACCRUED" });
    const c = e({ kind: "ACCRUED" });
    const all = [a, b, c, e({ kind: "REVERSED", refEntryId: a.id }), e({ kind: "APPROVED", refEntryId: b.id }), e({ kind: "APPROVED", refEntryId: c.id }), e({ kind: "PAID_MARKED", refEntryId: c.id })];
    const s = accrualStates(all);
    expect([s.get(a.id), s.get(b.id), s.get(c.id)]).toEqual(["REVERSED", "APPROVED", "PAID"]);
  });
});

describe("netAccruedInMonth (what the monthly cap counts)", () => {
  it("sums the referrer's accruals for the month and ignores reversed ones and other months", () => {
    const a = e({ kind: "ACCRUED", amountPaise: 100 });
    const b = e({ kind: "ACCRUED", amountPaise: 200 });
    const other = e({ kind: "ACCRUED", amountPaise: 400, periodMonth: "2027-02" });
    const someoneElse = e({ kind: "ACCRUED", amountPaise: 800, referrerId: "Z" });
    const all = [a, b, other, someoneElse, e({ kind: "REVERSED", refEntryId: b.id })];
    expect(netAccruedInMonth(all, "R", "2027-01")).toBe(100);
  });
});

describe("statementCandidates", () => {
  it("takes unreviewed-clean accruals up to the period, nothing already on a statement or flagged", () => {
    const ok = e({ kind: "ACCRUED" });
    const late = e({ kind: "ACCRUED", periodMonth: "2026-12" });
    const future = e({ kind: "ACCRUED", periodMonth: "2027-02" });
    const flagged = e({ kind: "ACCRUED", flags: ["VELOCITY"] });
    const onStatement = e({ kind: "ACCRUED" });
    const all = [ok, late, future, flagged, onStatement, e({ kind: "APPROVED", refEntryId: onStatement.id })];
    expect(statementCandidates(all, "R", "2027-01").map((x) => x.id).sort()).toEqual([ok.id, late.id].sort());
  });
});

describe("planPrepare", () => {
  const cand = [e({ kind: "ACCRUED", amountPaise: 300 }), e({ kind: "ACCRUED", amountPaise: 700 })];
  it("totals the lines and records who prepared", () => {
    const r = planPrepare({ actor: fin, existing: null, candidates: cand });
    expect(r).toMatchObject({ ok: true, totalPaise: 1000 });
  });
  it("refuses with nothing to pay, a non-finance role, or an already approved statement", () => {
    expect(planPrepare({ actor: fin, existing: null, candidates: [] }).ok).toBe(false);
    expect(planPrepare({ actor: { id: "x", role: "RM" }, existing: null, candidates: cand }).ok).toBe(false);
    const approved: StatementSnapshot = { status: "APPROVED", preparedById: "a", totalPaise: 1 };
    expect(planPrepare({ actor: fin, existing: approved, candidates: cand }).ok).toBe(false);
  });
  it("lets a prepared (not yet approved) statement be re-prepared", () => {
    const prepared: StatementSnapshot = { status: "PREPARED", preparedById: "a", totalPaise: 1 };
    expect(planPrepare({ actor: fin, existing: prepared, candidates: cand }).ok).toBe(true);
  });
});

describe("planApprove: four eyes", () => {
  const st: StatementSnapshot = { status: "PREPARED", preparedById: "u-admin", totalPaise: 1000 };
  it("the approver must differ from the preparer", () => {
    const r = planApprove({ statement: st, actor: admin });
    expect(r).toMatchObject({ ok: false });
    expect(planApprove({ statement: st, actor: fin }).ok).toBe(true);
  });
  it("only Admin or Finance, only a prepared statement, only a positive total", () => {
    expect(planApprove({ statement: st, actor: { id: "m", role: "MANAGER" } }).ok).toBe(false);
    expect(planApprove({ statement: { ...st, status: "APPROVED" }, actor: fin }).ok).toBe(false);
    expect(planApprove({ statement: { ...st, totalPaise: 0 }, actor: fin }).ok).toBe(false);
  });
  it("an unknown preparer fails closed", () => {
    expect(planApprove({ statement: { ...st, preparedById: "" }, actor: fin }).ok).toBe(false);
  });
});

describe("planMarkPaid: a marker, never a payment", () => {
  const st: StatementSnapshot = { status: "APPROVED", preparedById: "u-admin", totalPaise: 1000 };
  it("needs an approved statement and a bank reference", () => {
    expect(planMarkPaid({ statement: st, actor: fin, bankReference: "UTR2027010112345" })).toMatchObject({ ok: true, bankReference: "UTR2027010112345" });
    expect(planMarkPaid({ statement: st, actor: fin, bankReference: "" }).ok).toBe(false);
    expect(planMarkPaid({ statement: st, actor: fin, bankReference: "x" }).ok).toBe(false);
    expect(planMarkPaid({ statement: st, actor: fin, bankReference: "has spaces and ;" }).ok).toBe(false);
    expect(planMarkPaid({ statement: { ...st, status: "PREPARED" }, actor: fin, bankReference: "UTR2027010112345" }).ok).toBe(false);
    expect(planMarkPaid({ statement: { ...st, status: "PAID" }, actor: fin, bankReference: "UTR2027010112345" }).ok).toBe(false);
  });
});

describe("planReversal and planClearReview", () => {
  it("reverse only before a statement approves it, with a reason", () => {
    expect(planReversal({ state: "ACCRUED", actor: fin, reason: "Duplicate account found" }).ok).toBe(true);
    expect(planReversal({ state: "NEEDS_REVIEW", actor: admin, reason: "Fraud ring" }).ok).toBe(true);
    expect(planReversal({ state: "APPROVED", actor: fin, reason: "Fraud ring" }).ok).toBe(false);
    expect(planReversal({ state: "PAID", actor: fin, reason: "Fraud ring" }).ok).toBe(false);
    expect(planReversal({ state: "ACCRUED", actor: fin, reason: " " }).ok).toBe(false);
  });
  it("clear a review only when it is in review, with a note", () => {
    expect(planClearReview({ state: "NEEDS_REVIEW", actor: fin, note: "Checked: genuine family members" }).ok).toBe(true);
    expect(planClearReview({ state: "ACCRUED", actor: fin, note: "Checked: genuine" }).ok).toBe(false);
    expect(planClearReview({ state: "NEEDS_REVIEW", actor: fin, note: "ok" }).ok).toBe(false);
  });
});
