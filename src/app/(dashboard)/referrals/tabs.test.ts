import { describe, expect, it } from "vitest";

import { parseReferralTab, REFERRAL_TAB_KEYS, REFERRAL_TAB_LABEL } from "./tabs";

describe("referral tabs", () => {
  it("has the five sections in order, each labelled", () => {
    expect(REFERRAL_TAB_KEYS).toEqual(["overview", "referrers", "rewards", "rules", "statements"]);
    for (const k of REFERRAL_TAB_KEYS) expect(REFERRAL_TAB_LABEL[k]).toBeTruthy();
  });
  it("falls back to the overview for anything unknown", () => {
    expect(parseReferralTab("rules")).toBe("rules");
    expect(parseReferralTab("nope")).toBe("overview");
    expect(parseReferralTab(undefined)).toBe("overview");
    expect(parseReferralTab(["statements", "x"])).toBe("statements");
  });
});
