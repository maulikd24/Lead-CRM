import { describe, expect, it } from "vitest";

import type { LedgerEntry } from "./ledger";
import { formatRupees, funnelSteps, readyLabel, summarizeLedger, weeklyBuckets } from "./summary";

let n = 0;
const e = (over: Partial<LedgerEntry> & Pick<LedgerEntry, "kind">): LedgerEntry => ({ id: `e${++n}`, referrerId: "R", amountPaise: 1000, refEntryId: null, flags: [], periodMonth: "2027-01", ...over });

describe("summarizeLedger", () => {
  it("adds up each state in paise and counts entries", () => {
    const a = e({ kind: "ACCRUED", amountPaise: 100 });
    const b = e({ kind: "ACCRUED", amountPaise: 200, flags: ["VELOCITY"] });
    const c = e({ kind: "ACCRUED", amountPaise: 400 });
    const d = e({ kind: "ACCRUED", amountPaise: 800 });
    const f = e({ kind: "ACCRUED", amountPaise: 1600 });
    const all = [a, b, c, d, f, e({ kind: "APPROVED", refEntryId: c.id }), e({ kind: "APPROVED", refEntryId: d.id }), e({ kind: "PAID_MARKED", refEntryId: d.id }), e({ kind: "REVERSED", refEntryId: f.id })];
    expect(summarizeLedger(all)).toEqual({
      accrued: { paise: 100, count: 1 },
      needsReview: { paise: 200, count: 1 },
      approved: { paise: 400, count: 1 },
      paid: { paise: 800, count: 1 },
      reversed: { paise: 1600, count: 1 },
      clawedBack: { paise: 0, count: 0 },
      clawbackReview: { paise: 0, count: 0 },
    });
  });
  it("counts clawed-back rewards, and the clawbacks still waiting for a person (as a positive amount at stake)", () => {
    const a = e({ kind: "ACCRUED", amountPaise: 700 });
    const b = e({ kind: "ACCRUED", amountPaise: 300 });
    const ca = e({ kind: "CLAWBACK", refEntryId: a.id, amountPaise: -700, flags: ["CLAWBACK_KYC_REVOKED"] });
    const cb = e({ kind: "CLAWBACK", refEntryId: b.id, amountPaise: -300, flags: ["CLAWBACK_KYC_REVOKED"] });
    const s = summarizeLedger([a, b, ca, cb, e({ kind: "REVIEW_CLEARED", refEntryId: cb.id, amountPaise: 0 })]);
    expect(s.clawedBack).toEqual({ paise: 1000, count: 2 });
    expect(s.clawbackReview).toEqual({ paise: 700, count: 1 });
    expect(s.accrued.count).toBe(0);
  });
  it("is all zero for an empty ledger", () => expect(summarizeLedger([]).paid).toEqual({ paise: 0, count: 0 }));
});

describe("funnelSteps", () => {
  it("gives each step its share of the previous one and a bar width relative to the first", () => {
    const s = funnelSteps({ referrals: 40, kyc: 20, funded: 5 });
    expect(s.map((x) => [x.key, x.value, x.fromPrevious, x.widthPct])).toEqual([["referrals", 40, null, 100], ["kyc", 20, 0.5, 50], ["funded", 5, 0.25, 12.5]]);
  });
  it("never divides by zero", () => {
    const s = funnelSteps({ referrals: 0, kyc: 0, funded: 0 });
    expect(s.every((x) => x.fromPrevious === null || x.fromPrevious === 0)).toBe(true);
    expect(s.map((x) => x.widthPct)).toEqual([0, 0, 0]);
  });
});

describe("weeklyBuckets", () => {
  it("counts dates into 7-day buckets ending now, oldest first", () => {
    const now = new Date("2027-02-01T00:00:00Z");
    const d = (days: number) => new Date(now.getTime() - days * 86_400_000);
    expect(weeklyBuckets([d(1), d(2), d(8), d(30), d(100)], now, 4)).toEqual([0, 0, 1, 2]);
  });
});

describe("formatRupees", () => {
  it("formats paise as rupees in the Indian grouping", () => {
    expect(formatRupees(0)).toBe("₹0");
    expect(formatRupees(10000)).toBe("₹100");
    expect(formatRupees(12345678)).toBe("₹1,23,456.78");
    expect(formatRupees(150)).toBe("₹1.50");
  });
  it("puts the minus sign before the currency symbol, so a clawback reads -₹100, never ₹-100", () => {
    expect(formatRupees(-10000)).toBe("-₹100");
    expect(formatRupees(-250)).toBe("-₹2.50");
    expect(formatRupees(-12345678)).toBe("-₹1,23,456.78");
  });
});

describe("readyLabel (what a referrer's pending statement amount means)", () => {
  it("is payable when the lines add up to something", () => expect(readyLabel(50000)).toEqual({ payable: true, text: "₹500" }));
  it("carries forward when recoveries cancel or outweigh the rewards: nothing can be prepared", () => {
    expect(readyLabel(0)).toEqual({ payable: false, text: "Nothing payable yet. Carries forward." });
    expect(readyLabel(-10000)).toEqual({ payable: false, text: "-₹100 owed back. Carries forward." });
  });
});
