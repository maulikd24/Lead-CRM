import { describe, expect, it } from "vitest";

import { campaignCandidate } from "./campaign-attention";

describe("campaignCandidate", () => {
  it("has a campaign subject and no owner, and carries no personal data", () => {
    const c = campaignCandidate({ campaignId: "cx", campaignName: "Brand A", type: "spend_spike", severity: "high", detail: "Spend of 9,000 yesterday." }, new Date("2027-05-10T05:30:00Z"));
    expect(c).toMatchObject({ kind: "campaign_anomaly", ownerUserId: null, subject: { type: "campaign", id: "cx", label: "Brand A" }, override: "none" });
  });
});
