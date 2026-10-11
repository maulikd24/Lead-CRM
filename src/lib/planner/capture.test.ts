import { describe, expect, it } from "vitest";

import { extractCampaignCode, historyFromOutcomes, tallyOutcomes } from "./capture";

describe("extractCampaignCode (the intake seam)", () => {
  it("reads campaign_code from the attribution a form or webhook passes", () => {
    expect(extractCampaignCode({ attribution: { campaign_code: "CP-7K3Q9X" } })).toBe("CP-7K3Q9X");
  });
  it("normalises case and spaces", () => {
    expect(extractCampaignCode({ attribution: { campaign_code: " cp-7k3q9x " } })).toBe("CP-7K3Q9X");
  });
  it("reads the code out of a click-to-WhatsApp first message", () => {
    expect(extractCampaignCode({ message: "Hi, check your portfolio (Ref: CP-7K3Q9X)" })).toBe("CP-7K3Q9X");
  });
  it("prefers the explicit attribution over the message", () => {
    expect(extractCampaignCode({ attribution: { campaign_code: "CP-AAAAAA" }, message: "(Ref: CP-BBBBBB)" })).toBe("CP-AAAAAA");
  });
  it("ignores anything that is not a code", () => {
    expect(extractCampaignCode({ attribution: { campaign_code: "hello" } })).toBeNull();
    expect(extractCampaignCode({ message: "ref CP-0O1IL2" })).toBeNull();
    expect(extractCampaignCode({})).toBeNull();
  });
});

describe("tallyOutcomes and historyFromOutcomes", () => {
  const rows = [
    { code: "CP-AAAAAA", kyc: true, funded: true },
    { code: "CP-AAAAAA", kyc: true, funded: false },
    { code: "CP-AAAAAA", kyc: false, funded: false },
    { code: "CP-BBBBBB", kyc: false, funded: false },
  ];
  it("counts leads, KYC and funded per code", () => {
    const t = tallyOutcomes(rows);
    expect(t.get("CP-AAAAAA")).toEqual({ leads: 3, kyc: 2, funded: 1 });
    expect(t.get("CP-BBBBBB")).toEqual({ leads: 1, kyc: 0, funded: 0 });
  });
  it("builds one history row per past plan, with its budget, and none for a plan with no leads", () => {
    const h = historyFromOutcomes(
      [{ code: "CP-AAAAAA", budgetInr: 20000 }, { code: "CP-BBBBBB", budgetInr: null }, { code: "CP-CCCCCC", budgetInr: 5000 }],
      tallyOutcomes(rows),
    );
    expect(h).toEqual([{ leads: 3, kyc: 2, funded: 1, budgetInr: 20000 }, { leads: 1, kyc: 0, funded: 0, budgetInr: null }]);
  });
});
