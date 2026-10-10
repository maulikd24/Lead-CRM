import { describe, expect, it } from "vitest";

import { SAMPLE_TABS, partnerTabFor, partnerTabsFor } from "./tabs";

describe("Partner workspace tabs", () => {
  it("lists the sections in order, Overview first, nothing dropped", () => {
    expect(SAMPLE_TABS.map((t) => t.key)).toEqual(["overview", "affiliates", "referred-users", "payouts"]);
  });
  it("maps every URL to its tab", () => {
    expect(partnerTabFor("/partners")).toBe("overview");
    expect(partnerTabFor("/partners/")).toBe("overview");
    expect(partnerTabFor("/partners/affiliates")).toBe("affiliates");
    expect(partnerTabFor("/partners/referred-users")).toBe("referred-users");
    expect(partnerTabFor("/partners/payouts")).toBe("payouts");
    expect(partnerTabFor("/partners/contract")).toBe("overview");
  });
  it("keeps an affiliate's detail page under Affiliates and falls back to Overview", () => {
    expect(partnerTabFor("/partners/affiliates/abc123")).toBe("affiliates");
    expect(partnerTabFor("/partners/affiliatesX")).toBe("overview");
    expect(partnerTabFor("/somewhere/else")).toBe("overview");
  });
  it("gives every tab a distinct href", () => {
    expect(new Set(SAMPLE_TABS.map((t) => t.href)).size).toBe(SAMPLE_TABS.length);
  });
});

describe("tabs by source", () => {
  it("the sample source keeps the four original sections and has no contract check", () => {
    expect(partnerTabsFor("sample").map((t) => t.key)).toEqual(["overview", "affiliates", "referred-users", "payouts"]);
  });
  it("the native source adds the network, commissions and statements and has no contract check", () => {
    const keys = partnerTabsFor("native").map((t) => t.key);
    expect(keys).toEqual(["overview", "affiliates", "network", "referred-users", "commissions", "payouts", "statements"]);
    expect(keys).not.toContain("contract");
  });
  it("maps native URLs, keeping statement and partner detail pages under their tab", () => {
    const tabs = partnerTabsFor("native");
    expect(partnerTabFor("/partners/network", tabs)).toBe("network");
    expect(partnerTabFor("/partners/commissions", tabs)).toBe("commissions");
    expect(partnerTabFor("/partners/statements", tabs)).toBe("statements");
    expect(partnerTabFor("/partners/statements/abc", tabs)).toBe("statements");
    expect(partnerTabFor("/partners/affiliates/abc", tabs)).toBe("affiliates");
    expect(partnerTabFor("/partners/contract", tabs)).toBe("overview");
  });
  it("every native tab has a distinct href", () => {
    const tabs = partnerTabsFor("native");
    expect(new Set(tabs.map((t) => t.href)).size).toBe(tabs.length);
  });
});
