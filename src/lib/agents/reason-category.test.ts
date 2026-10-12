import { describe, expect, it } from "vitest";
import { reasonCategoryFor, REASON_CATEGORIES } from "./reason-category";

const b = (programme: string, topic: string | null = null, keys: string[] = []) => ({
  whyContactingNow: { programme, topic },
  currentSituations: keys.map((key) => ({ key })),
});

describe("reasonCategoryFor", () => {
  it("maps KYC to kyc_pending, or kyc_stuck_in_documents when the blocker is documents", () => {
    expect(reasonCategoryFor(b("Complete KYC", "Make first contact"))).toBe("kyc_pending");
    expect(reasonCategoryFor(b("Complete KYC", null))).toBe("kyc_pending");
    expect(reasonCategoryFor(b("Complete KYC", "2 mandatory documents pending verification"))).toBe("kyc_stuck_in_documents");
    expect(reasonCategoryFor(b("Complete KYC", "Start document collection"))).toBe("kyc_stuck_in_documents");
  });
  it("maps Fund account to signed_up_not_funded", () => {
    expect(reasonCategoryFor(b("Fund account", "Follow up on funding"))).toBe("signed_up_not_funded");
  });
  it("maps First transaction to funded_no_first_transaction when that situation holds, else other_onboarding", () => {
    expect(reasonCategoryFor(b("First transaction", "Place the first trade", ["funded_no_first_transaction"]))).toBe("funded_no_first_transaction");
    expect(reasonCategoryFor(b("First transaction", "Schedule dealer intro", []))).toBe("other_onboarding");
  });
  it("maps anything unknown to other_onboarding", () => {
    expect(reasonCategoryFor(b("PMS / AIF opportunity"))).toBe("other_onboarding");
    expect(reasonCategoryFor(b(""))).toBe("other_onboarding");
  });
  it("only ever returns a fixed enum value, whatever the free text says", () => {
    const out = reasonCategoryFor(b("Complete KYC", "documents for Riya Sharma PAN ABCDE1234F"));
    expect(REASON_CATEGORIES).toContain(out);
  });
});
