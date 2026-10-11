import { describe, expect, it } from "vitest";

import { parseReferralTab, referralTabsFor, REFERRAL_TAB_KEYS, REFERRAL_TAB_LABEL } from "./tabs";

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

describe("referral tabs per role (campaign level for marketing)", () => {
  it("shows ADMIN every section", () => expect(referralTabsFor("ADMIN")).toEqual([...REFERRAL_TAB_KEYS]));
  it("shows FINANCE every section, as before", () => expect(referralTabsFor("FINANCE")).toEqual([...REFERRAL_TAB_KEYS]));
  it("shows MARKETING only the funnel and the rules: no referrers, no rewards ledger rows, no statements", () => {
    expect(referralTabsFor("MARKETING")).toEqual(["overview", "rules"]);
  });
  it("shows no section to anyone else", () => {
    for (const role of ["RM", "MANAGER", "TEAM_MANAGER", "PARTNER", "DEALER"] as const) expect(referralTabsFor(role)).toEqual([]);
  });
});
