import { describe, expect, it } from "vitest";

import { PARTNER_TABS, partnerTabFor } from "./tabs";

describe("Partner workspace tabs", () => {
  it("lists the sections in order, Overview first, nothing dropped", () => {
    expect(PARTNER_TABS.map((t) => t.key)).toEqual(["overview", "affiliates", "referred-users", "payouts", "contract"]);
    expect(PARTNER_TABS.find((t) => t.key === "contract")?.label).toBe("Contract check");
  });
  it("maps every URL to its tab", () => {
    expect(partnerTabFor("/partners")).toBe("overview");
    expect(partnerTabFor("/partners/")).toBe("overview");
    expect(partnerTabFor("/partners/affiliates")).toBe("affiliates");
    expect(partnerTabFor("/partners/referred-users")).toBe("referred-users");
    expect(partnerTabFor("/partners/payouts")).toBe("payouts");
    expect(partnerTabFor("/partners/contract")).toBe("contract");
  });
  it("keeps an affiliate's detail page under Affiliates and falls back to Overview", () => {
    expect(partnerTabFor("/partners/affiliates/abc123")).toBe("affiliates");
    expect(partnerTabFor("/partners/affiliatesX")).toBe("overview");
    expect(partnerTabFor("/somewhere/else")).toBe("overview");
  });
  it("gives every tab a distinct href", () => {
    expect(new Set(PARTNER_TABS.map((t) => t.href)).size).toBe(PARTNER_TABS.length);
  });
});
