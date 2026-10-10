import { describe, expect, it } from "vitest";
import { MIN_LEADS_FOR_CREATIVE_VERDICT, buildCreativeReport, type CreativeDayRow } from "./creatives";

const row = (over: Partial<CreativeDayRow> = {}): CreativeDayRow => ({ channel: "google", campaignId: "c1", campaignName: "Search", adId: "a1", adName: "Headline A", format: "RESPONSIVE_SEARCH_AD", date: "2026-10-01", spendMinor: 100000, currency: "INR", impressions: 1000, clicks: 40, leads: 4, ...over });

describe("buildCreativeReport", () => {
  it("sums each ad across days and derives CTR, cost per click and cost per lead (platform-reported leads)", () => {
    const r = buildCreativeReport([row(), row({ date: "2026-10-02", spendMinor: 50000, leads: 1, clicks: 10, impressions: 500 }), row({ adId: "a2", adName: "Headline B", spendMinor: 30000, leads: 0 })]);
    const a = r.ads.find((x) => x.adId === "a1")!;
    expect(a).toMatchObject({ spend: 1500, impressions: 1500, clicks: 50, leads: 5, days: 2, campaignName: "Search" });
    expect(a.ctr).toBeCloseTo(50 / 1500, 5);
    expect(a.cpc).toBe(30);
    expect(a.cpl).toBe(300);
    expect(r.ads.find((x) => x.adId === "a2")!.cpl).toBeNull();
  });

  it("orders by spend, biggest first, and totals the lot", () => {
    const r = buildCreativeReport([row({ adId: "small", spendMinor: 100 }), row({ adId: "big", spendMinor: 900000 })]);
    expect(r.ads.map((a) => a.adId)).toEqual(["big", "small"]);
    expect(r.totals).toMatchObject({ spend: 9001, ads: 2 });
  });

  it("marks the cheapest and the dearest ad per lead, but only among ads with enough leads to say anything", () => {
    const many = MIN_LEADS_FOR_CREATIVE_VERDICT;
    const r = buildCreativeReport([
      row({ adId: "cheap", spendMinor: 100000, leads: many }),
      row({ adId: "dear", spendMinor: 900000, leads: many }),
      row({ adId: "few", spendMinor: 1000, leads: 1 }),
    ]);
    const flag = (id: string) => r.ads.find((a) => a.adId === id)!.verdict;
    expect(flag("cheap")).toBe("best");
    expect(flag("dear")).toBe("worst");
    expect(flag("few")).toBeNull();
  });

  it("no verdict when only one ad qualifies", () => {
    const r = buildCreativeReport([row({ leads: MIN_LEADS_FOR_CREATIVE_VERDICT })]);
    expect(r.ads[0].verdict).toBeNull();
  });

  it("uses the main currency and says how many rows in another currency were left out", () => {
    const r = buildCreativeReport([row(), row({ adId: "z", currency: "USD", spendMinor: 5 })]);
    expect(r.currency).toBe("INR");
    expect(r.ads).toHaveLength(1);
    expect(r.otherCurrencyRows).toBe(1);
  });

  it("is empty and null-safe with no rows", () => {
    const r = buildCreativeReport([]);
    expect(r.ads).toEqual([]);
    expect(r.currency).toBeNull();
    expect(r.totals.cpl).toBeNull();
  });
});
