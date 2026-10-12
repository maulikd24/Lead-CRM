import { describe, expect, it } from "vitest";

import { currentStage, deriveEvents, type Evidence } from "./state-machine";

const d = (s: string) => new Date(s);
const ev = (over: Partial<Evidence> = {}): Evidence => ({ kycApprovedAt: null, firstFundedAt: null, fundedAmountPaise: null, ...over });

describe("deriveEvents", () => {
  it("records nothing when the client has done nothing yet", () => {
    expect(deriveEvents(ev(), new Set(["SIGNED_UP"]))).toEqual([]);
  });
  it("records KYC complete with the approval time", () => {
    expect(deriveEvents(ev({ kycApprovedAt: d("2027-01-12T00:00:00Z") }), new Set(["SIGNED_UP"]))).toEqual([{ type: "KYC_COMPLETE", occurredAt: d("2027-01-12T00:00:00Z"), amountPaise: null }]);
  });
  it("does not invent funding before KYC: order is enforced", () => {
    expect(deriveEvents(ev({ firstFundedAt: d("2027-01-13T00:00:00Z"), fundedAmountPaise: 500000 }), new Set(["SIGNED_UP"]))).toEqual([]);
  });
  it("records KYC then funding in order in one pass, funding with its amount", () => {
    const out = deriveEvents(ev({ kycApprovedAt: d("2027-01-12T00:00:00Z"), firstFundedAt: d("2027-01-13T00:00:00Z"), fundedAmountPaise: 500000 }), new Set(["SIGNED_UP"]));
    expect(out.map((e) => e.type)).toEqual(["KYC_COMPLETE", "FIRST_FUNDING"]);
    expect(out[1].amountPaise).toBe(500000);
  });
  it("is idempotent: events already recorded are never produced again", () => {
    const evidence = ev({ kycApprovedAt: d("2027-01-12T00:00:00Z"), firstFundedAt: d("2027-01-13T00:00:00Z"), fundedAmountPaise: 1 });
    expect(deriveEvents(evidence, new Set(["SIGNED_UP", "KYC_COMPLETE", "FIRST_FUNDING"]))).toEqual([]);
  });
  it("never rewrites history: a later change in the evidence does not re-time a recorded event", () => {
    expect(deriveEvents(ev({ kycApprovedAt: d("2027-02-01T00:00:00Z") }), new Set(["SIGNED_UP", "KYC_COMPLETE"]))).toEqual([]);
  });
  it("a funding with no amount on file records the event with a zero amount", () => {
    const out = deriveEvents(ev({ kycApprovedAt: d("2027-01-12T00:00:00Z"), firstFundedAt: d("2027-01-13T00:00:00Z") }), new Set(["SIGNED_UP", "KYC_COMPLETE"]));
    expect(out).toEqual([{ type: "FIRST_FUNDING", occurredAt: d("2027-01-13T00:00:00Z"), amountPaise: 0 }]);
  });
});

describe("currentStage", () => {
  it("is the furthest event reached", () => {
    expect(currentStage(new Set(["SIGNED_UP"]))).toBe("SIGNED_UP");
    expect(currentStage(new Set(["SIGNED_UP", "KYC_COMPLETE"]))).toBe("KYC_COMPLETE");
    expect(currentStage(new Set(["SIGNED_UP", "KYC_COMPLETE", "FIRST_FUNDING"]))).toBe("FIRST_FUNDING");
  });
});
