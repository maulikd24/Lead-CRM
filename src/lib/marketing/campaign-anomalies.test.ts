import { describe, expect, it } from "vitest";

import { detectCampaignAnomalies, type DailyRow } from "./campaign-anomalies";

const TODAY = new Date("2027-05-10T08:00:00Z");
const day = (n: number) => new Date(Date.UTC(2027, 4, 10 - n));

function rows(campaignId: string, spends: number[], leads: number[]): DailyRow[] {
  // spends[0] is the most recent complete day (yesterday)
  return spends.map((s, i) => ({ campaignId, campaignName: `Campaign ${campaignId}`, date: day(i + 1), spendMinor: s, leads: leads[i] ?? 0, impressions: 1000, clicks: 10 }));
}

describe("detectCampaignAnomalies", () => {
  it("flags a spend spike against the trailing average", () => {
    const out = detectCampaignAnomalies(rows("a", [900_000, 100_000, 110_000, 100_000, 90_000, 100_000, 105_000], [5, 5, 5, 5, 5, 5, 5]), TODAY);
    expect(out.map((o) => o.type)).toContain("spend_spike");
  });
  it("flags spend with no leads over three days", () => {
    const out = detectCampaignAnomalies(rows("b", [100_000, 100_000, 100_000, 100_000, 100_000], [0, 0, 0, 4, 4]), TODAY);
    expect(out.map((o) => o.type)).toContain("spend_no_leads");
  });
  it("flags a drop to zero spend on a campaign that was spending", () => {
    const out = detectCampaignAnomalies(rows("c", [0, 100_000, 100_000, 100_000, 100_000], [0, 3, 3, 3, 3]), TODAY);
    expect(out.map((o) => o.type)).toContain("spend_stopped");
  });
  it("says nothing about a steady campaign, or a small one", () => {
    expect(detectCampaignAnomalies(rows("d", [100_000, 102_000, 98_000, 101_000, 99_000, 100_000, 100_000], [5, 5, 5, 5, 5, 5, 5]), TODAY)).toEqual([]);
    expect(detectCampaignAnomalies(rows("e", [20_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000], [0, 0, 0, 0, 0, 0, 0]), TODAY)).toEqual([]); // below the noise floor
  });
  it("needs enough history before it judges", () => {
    expect(detectCampaignAnomalies(rows("f", [900_000, 100_000], [0, 0]), TODAY)).toEqual([]);
  });
  it("carries no personal data: only campaign id and name, aggregates and a reason", () => {
    const [o] = detectCampaignAnomalies(rows("a", [900_000, 100_000, 110_000, 100_000, 90_000, 100_000, 105_000], [5, 5, 5, 5, 5, 5, 5]), TODAY);
    expect(Object.keys(o).sort()).toEqual(["campaignId", "campaignName", "detail", "severity", "type"]);
  });
});
