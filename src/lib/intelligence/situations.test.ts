import { describe, expect, it } from "vitest";
import { detectSituations } from "./situations";
import { makeFacts } from "@/test/factories";

describe("detectSituations", () => {
  it("flags KYC pending as high after 3 days in stage", () => {
    const out = detectSituations(makeFacts(), "KYC");
    const kyc = out.find((s) => s.key === "kyc_pending");
    expect(kyc?.severity).toBe("high");
  });

  it("does not flag KYC pending once KYC is approved", () => {
    const out = detectSituations(makeFacts({ kycApproved: true }), "KYC");
    expect(out.find((s) => s.key === "kyc_pending")).toBeUndefined();
  });

  it("returns nothing for an archived client", () => {
    const facts = makeFacts();
    facts.client.status = "ARCHIVED";
    expect(detectSituations(facts, "KYC")).toEqual([]);
  });

  it("returns nothing for a lost lifecycle", () => {
    expect(detectSituations(makeFacts(), "Lost")).toEqual([]);
  });
});
