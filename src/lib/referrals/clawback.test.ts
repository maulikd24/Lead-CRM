import { describe, expect, it } from "vitest";

import { planClawbacks } from "./clawback";
import type { LedgerEntry } from "./ledger";

let n = 0;
const T = (s: string) => new Date(s);
const accrual = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({ id: `a${++n}`, kind: "ACCRUED", referrerId: "R", amountPaise: 10000, refEntryId: null, flags: [], periodMonth: "2027-01", referralId: "ref1", eventType: "KYC_COMPLETE", ruleId: "rule1", clawbackUntil: T("2027-02-10T00:00:00Z"), ...over });
const NOW = T("2027-01-25T06:00:00Z");

describe("planClawbacks", () => {
  it("takes back a KYC reward when KYC was revoked inside the window: one appended, negative, flagged entry", () => {
    const a = accrual();
    const out = planClawbacks({ ledger: [a], referralId: "ref1", evidence: { kycReversedAt: T("2027-01-20T00:00:00Z") }, now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ idempotencyKey: `clawback:${a.id}`, kind: "CLAWBACK", referrerId: "R", referralId: "ref1", eventType: "KYC_COMPLETE", ruleId: "rule1", refEntryId: a.id, amountPaise: -10000, periodMonth: "2027-01", flags: ["CLAWBACK_KYC_REVOKED"], actorId: null, statementId: null });
    expect(out[0].note).toMatch(/KYC/);
  });
  it("takes back a funding reward when the funding was reversed inside the window", () => {
    const a = accrual({ eventType: "FIRST_FUNDING", amountPaise: 50000 });
    const out = planClawbacks({ ledger: [a], referralId: "ref1", evidence: { fundingReversedAt: T("2027-02-01T00:00:00Z") }, now: NOW });
    expect(out[0]).toMatchObject({ amountPaise: -50000, flags: ["CLAWBACK_FUNDING_REVERSED"], eventType: "FIRST_FUNDING" });
  });
  it("each reversal only touches the reward of its own event", () => {
    const kyc = accrual();
    const fund = accrual({ eventType: "FIRST_FUNDING" });
    expect(planClawbacks({ ledger: [kyc, fund], referralId: "ref1", evidence: { kycReversedAt: T("2027-01-20T00:00:00Z") }, now: NOW }).map((e) => e.refEntryId)).toEqual([kyc.id]);
    expect(planClawbacks({ ledger: [kyc, fund], referralId: "ref1", evidence: { fundingReversedAt: T("2027-01-20T00:00:00Z") }, now: NOW }).map((e) => e.refEntryId)).toEqual([fund.id]);
  });
  it("a reversal AFTER the window closed takes nothing back", () => {
    const a = accrual();
    expect(planClawbacks({ ledger: [a], referralId: "ref1", evidence: { kycReversedAt: T("2027-02-11T00:00:00Z") }, now: T("2027-03-01T00:00:00Z") })).toEqual([]);
  });
  it("the window is judged by WHEN it was reversed, not when the job noticed: a late job still takes it back", () => {
    const a = accrual();
    const out = planClawbacks({ ledger: [a], referralId: "ref1", evidence: { kycReversedAt: T("2027-02-05T00:00:00Z") }, now: T("2027-03-01T00:00:00Z") });
    expect(out).toHaveLength(1);
    expect(out[0].periodMonth).toBe("2027-03");
  });
  it("the last instant of the window still counts; one millisecond later does not", () => {
    const a = accrual();
    expect(planClawbacks({ ledger: [a], referralId: "ref1", evidence: { kycReversedAt: T("2027-02-10T00:00:00.000Z") }, now: NOW })).toHaveLength(1);
    expect(planClawbacks({ ledger: [a], referralId: "ref1", evidence: { kycReversedAt: T("2027-02-10T00:00:00.001Z") }, now: NOW })).toHaveLength(0);
  });
  it("rewards with no window are never taken back", () => {
    expect(planClawbacks({ ledger: [accrual({ clawbackUntil: null }), accrual({ clawbackUntil: undefined })], referralId: "ref1", evidence: { kycReversedAt: T("2027-01-20T00:00:00Z") }, now: NOW })).toEqual([]);
  });
  it("nothing reversed, nothing taken back; the signup event is never taken back", () => {
    expect(planClawbacks({ ledger: [accrual()], referralId: "ref1", evidence: {}, now: NOW })).toEqual([]);
    expect(planClawbacks({ ledger: [accrual({ eventType: "SIGNED_UP" })], referralId: "ref1", evidence: { kycReversedAt: T("2027-01-20T00:00:00Z"), fundingReversedAt: T("2027-01-20T00:00:00Z") }, now: NOW })).toEqual([]);
  });
  it("is idempotent: a reward already taken back (or waived, or reversed) is left alone", () => {
    const a = accrual();
    const done = { ...accrual(), id: "c1", kind: "CLAWBACK" as const, refEntryId: a.id, amountPaise: -10000 };
    const ev = { kycReversedAt: T("2027-01-20T00:00:00Z") };
    expect(planClawbacks({ ledger: [a, done], referralId: "ref1", evidence: ev, now: NOW })).toEqual([]);
    expect(planClawbacks({ ledger: [a, done, { ...accrual(), id: "w1", kind: "CLAWBACK_WAIVED", refEntryId: "c1", amountPaise: 10000 }], referralId: "ref1", evidence: ev, now: NOW })).toEqual([]);
    expect(planClawbacks({ ledger: [a, { ...accrual(), id: "r1", kind: "REVERSED", refEntryId: a.id }], referralId: "ref1", evidence: ev, now: NOW })).toEqual([]);
  });
  it("only this referral's rewards are considered, and an approved or paid reward is taken back too", () => {
    const mine = accrual();
    const other = accrual({ referralId: "ref2" });
    const paid = accrual();
    const ledger = [mine, other, paid, { ...accrual(), id: "p1", kind: "APPROVED" as const, refEntryId: paid.id }, { ...accrual(), id: "p2", kind: "PAID_MARKED" as const, refEntryId: paid.id }];
    const out = planClawbacks({ ledger, referralId: "ref1", evidence: { kycReversedAt: T("2027-01-20T00:00:00Z") }, now: NOW });
    expect(out.map((e) => e.refEntryId).sort()).toEqual([mine.id, paid.id].sort());
  });
  it("ignores rewards that were never positive", () => {
    expect(planClawbacks({ ledger: [accrual({ amountPaise: 0 })], referralId: "ref1", evidence: { kycReversedAt: T("2027-01-20T00:00:00Z") }, now: NOW })).toEqual([]);
  });
});
