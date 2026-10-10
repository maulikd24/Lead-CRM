import { describe, expect, it } from "vitest";

import { formatDuration, buildJourney, type JourneyInput } from "./journey";
import type { Attribution, Touch } from "./model";

const t = (iso: string) => new Date(iso);
const touch: Touch = {
  kind: "meta_ad", at: "2027-03-02T04:59:30.000Z", creative: "Retire at 55 carousel", form: "F9", code: null, confidence: "high", rule: "campaign_id",
  campaign: { key: "meta:111", id: "111", name: "Retirement Planning - Lead Form", inSpendData: true },
  why: 'Credited to "Retirement Planning - Lead Form": its campaign id 111 is a synced Meta campaign.',
};
const attributed: Attribution = { status: "attributed", first: touch, last: touch, touches: [touch], confidence: "high", reason: null, reasonText: null };

const input = (over: Partial<JourneyInput> = {}): JourneyInput => ({
  now: t("2027-03-20T05:00:00Z"),
  createdAt: t("2027-03-02T05:00:00Z"),
  attribution: attributed,
  slaMinutes: 15,
  firstContactAt: t("2027-03-02T05:09:00Z"),
  kycSteps: [
    { type: "PAN_VERIFICATION", status: "VERIFIED", startedAt: t("2027-03-02T06:00:00Z"), decidedAt: t("2027-03-02T06:05:00Z") },
    { type: "ESIGN", status: "VERIFIED", startedAt: t("2027-03-03T06:00:00Z"), decidedAt: t("2027-03-04T09:00:00Z") },
  ],
  kycApprovedAt: t("2027-03-04T10:00:00Z"),
  firstFundedAt: t("2027-03-08T05:00:00Z"),
  firstFundedAmount: 750000,
  firstTransactionAt: t("2027-03-09T05:00:00Z"),
  firstRevenueAt: t("2027-03-31T05:00:00Z"),
  revenueToDate: 18250,
  ...over,
});

describe("formatDuration", () => {
  it("reads like a person would say it", () => {
    expect(formatDuration(40_000)).toBe("under a minute");
    expect(formatDuration(9 * 60_000)).toBe("9 min");
    expect(formatDuration(135 * 60_000)).toBe("2 h 15 min");
    expect(formatDuration((3 * 24 + 4) * 3_600_000)).toBe("3 d 4 h");
    expect(formatDuration(2 * 3_600_000)).toBe("2 h");
  });
});

describe("buildJourney", () => {
  it("lists the steps in order with dates, and measures each from the lead being created", () => {
    const j = buildJourney(input());
    expect(j.steps.map((s) => s.key)).toEqual(["first_touch", "lead_created", "first_contact", "kyc_pan_verification", "kyc_esign", "kyc_approved", "first_funding", "first_transaction", "revenue"]);
    const byKey = Object.fromEntries(j.steps.map((s) => [s.key, s]));
    expect(byKey.first_touch.at).toEqual(t("2027-03-02T04:59:30Z"));
    expect(byKey.first_contact.detail).toMatch(/9 min/);
    expect(byKey.first_contact.state).toBe("done");
    expect(byKey.first_contact.slaMet).toBe(true);
    expect(byKey.kyc_pan_verification.detail).toMatch(/5 min/);
    expect(byKey.kyc_esign.detail).toMatch(/1 d 3 h/);
    expect(byKey.first_funding.detail).toMatch(/7,50,000/);
    expect(byKey.first_funding.sinceLead).toBe("6 d");
    expect(byKey.revenue.detail).toMatch(/18,250/);
  });

  it("marks a slow first contact as past SLA with by how much", () => {
    const j = buildJourney(input({ firstContactAt: t("2027-03-02T06:00:00Z") }));
    const s = j.steps.find((x) => x.key === "first_contact")!;
    expect(s.slaMet).toBe(false);
    expect(s.detail).toMatch(/1 h/);
    expect(s.detail).toMatch(/45 min past/);
  });

  it("a customer not contacted yet is overdue once the SLA has passed, and pending inside it", () => {
    const overdue = buildJourney(input({ firstContactAt: null, kycSteps: [], kycApprovedAt: null, firstFundedAt: null, firstTransactionAt: null, firstRevenueAt: null, revenueToDate: 0 }));
    const c = overdue.steps.find((x) => x.key === "first_contact")!;
    expect(c.state).toBe("overdue");
    expect(c.detail).toMatch(/not contacted/i);
    const fresh = buildJourney(input({ now: t("2027-03-02T05:10:00Z"), firstContactAt: null, kycSteps: [], kycApprovedAt: null, firstFundedAt: null, firstTransactionAt: null, firstRevenueAt: null, revenueToDate: 0 }));
    expect(fresh.steps.find((x) => x.key === "first_contact")!.state).toBe("pending");
    expect(fresh.steps.find((x) => x.key === "first_contact")!.detail).toMatch(/5 min left/);
  });

  it("steps not reached yet are pending and carry no date; nothing is invented", () => {
    const j = buildJourney(input({ kycSteps: [{ type: "PAN_VERIFICATION", status: "IN_PROGRESS", startedAt: t("2027-03-19T05:00:00Z"), decidedAt: null }], kycApprovedAt: null, firstFundedAt: null, firstFundedAmount: null, firstTransactionAt: null, firstRevenueAt: null, revenueToDate: 0 }));
    const pan = j.steps.find((x) => x.key === "kyc_pan_verification")!;
    expect(pan.state).toBe("pending");
    expect(pan.detail).toMatch(/open for 1 d/i);
    for (const key of ["kyc_approved", "first_funding", "first_transaction", "revenue"]) {
      const s = j.steps.find((x) => x.key === key)!;
      expect(s.at).toBeNull();
      expect(s.state).toBe("pending");
    }
    expect(j.steps.find((x) => x.key === "revenue")!.detail).toMatch(/no revenue/i);
  });

  it("a failed KYC step is shown as failed", () => {
    const j = buildJourney(input({ kycSteps: [{ type: "BANK_VERIFICATION", status: "FAILED", startedAt: t("2027-03-03T05:00:00Z"), decidedAt: t("2027-03-03T05:30:00Z") }] }));
    expect(j.steps.find((x) => x.key === "kyc_bank_verification")!.state).toBe("failed");
  });

  it("an unattributed customer says so and keeps every other step", () => {
    const j = buildJourney(input({ attribution: { status: "unattributed", first: null, last: null, touches: [], confidence: null, reason: "manual_source", reasonText: 'Entered with the source "WhatsApp".' } }));
    expect(j.steps[0].key).toBe("first_touch");
    expect(j.steps[0].state).toBe("unknown");
    expect(j.steps[0].detail).toMatch(/not known/i);
    expect(j.why).toMatch(/WhatsApp/);
    expect(j.steps.length).toBeGreaterThan(5);
  });

  it("carries the why-attributed note, confidence and the first and last touch", () => {
    const j = buildJourney(input());
    expect(j.confidence).toBe("high");
    expect(j.why).toMatch(/campaign id 111/);
    expect(j.first?.creative).toBe("Retire at 55 carousel");
  });
});
