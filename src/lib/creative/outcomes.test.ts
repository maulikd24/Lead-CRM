import { describe, expect, it } from "vitest";

import type { MarketingReport } from "@/lib/marketing/metrics";
import { attributeLeadsToAds, createFakeOutcomeProvider, createSimpleOutcomeProvider, type AdLead } from "./outcomes";

const range = { from: "2026-09-01", to: "2026-09-30" };

describe("fake provider", () => {
  it("returns exactly what it was given, filtered by level and channel", async () => {
    const p = createFakeOutcomeProvider({ rows: [
      { level: "campaign", channel: "meta", campaignId: "c1", campaignName: "C1", adId: null, adName: null, format: null, spend: 100, currency: "INR", impressions: 1, clicks: 1, platformLeads: 1, leads: 1, contactedInSla: 1, kyc: 1, funded: 1, revenue: 5, outcomes: "crm" },
      { level: "ad", channel: "google", campaignId: "c2", campaignName: "C2", adId: "a1", adName: "A1", format: "RSA", spend: 10, currency: "INR", impressions: 1, clicks: 1, platformLeads: 1, leads: null, contactedInSla: null, kyc: null, funded: null, revenue: null, outcomes: "platform_only" },
    ], asOf: "2026-09-30T10:00:00Z" });
    expect((await p.getOutcomes({ ...range, level: "campaign" })).rows).toHaveLength(1);
    expect((await p.getOutcomes({ ...range, level: "ad", channel: "meta" })).rows).toHaveLength(0);
    expect((await p.getOutcomes({ ...range, level: "ad" })).asOf).toBe("2026-09-30T10:00:00Z");
  });
});

const report = (over: Partial<MarketingReport["totals"]> = {}): MarketingReport => ({
  range, currency: "INR",
  totals: { spend: 1000, impressions: 5000, clicks: 100, ctr: 0.02, reach: 4000, metaLeads: 12, crmLeads: 10, kyc: 4, funded: 2, firstTransaction: 1, aum: 0, revenue: 800, cpl: 100, cplMeta: 83, kycRate: 0.4, costPerKyc: 250, costPerFunded: 500, aumPerRupee: null, roas: 0.8, ...over },
  funnel: [], daily: [], unattributed: { leads: 0, kyc: 0, funded: 0, aum: 0, reasons: { no_campaign_info: 0, no_match: 0, ambiguous_campaign_name: 0 } }, excluded: { nonMeta: 0, duplicates: 0, otherCurrencyRows: 0 }, notes: [],
  campaigns: [{ campaignId: "c1", name: "Demat basics", spend: 1000, impressions: 5000, clicks: 100, ctr: 0.02, reach: 4000, metaLeads: 12, crmLeads: 10, kyc: 4, funded: 2, firstTransaction: 1, aum: 0, revenue: 800, cpl: 100, cplMeta: 83, kycRate: 0.4, costPerKyc: 250, costPerFunded: 500, aumPerRupee: null, roas: 0.8, quality: { key: "on_par", label: "On par", detail: "", tone: "neutral" }, spark: [] }],
});

describe("simple provider over existing data", () => {
  const deps = {
    loadReports: async () => [{ channel: "meta" as const, report: report(), asOf: new Date("2026-09-30T08:00:00Z") }],
    loadAdDaily: async () => [
      { channel: "google" as const, campaignId: "g1", campaignName: "Search", adId: "a1", adName: "Ad one", format: "RESPONSIVE_SEARCH_AD", date: "2026-09-10", spendMinor: 50_000, currency: "INR", impressions: 1000, clicks: 30, leads: 3 },
    ],
    loadCampaignDaily: async () => [],
    loadAdLeads: async (): Promise<AdLead[]> => [],
  };

  it("campaign level: the CRM's own outcomes, contacted-in-SLA not available", async () => {
    const r = await createSimpleOutcomeProvider(deps).getOutcomes({ ...range, level: "campaign" });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ campaignId: "c1", spend: 1000, leads: 10, kyc: 4, funded: 2, revenue: 800, contactedInSla: null, outcomes: "crm" });
    expect(r.asOf).toBe("2026-09-30T08:00:00.000Z");
  });

  it("ad level without ad ids on leads: platform numbers only, never an invented funded count", async () => {
    const r = await createSimpleOutcomeProvider(deps).getOutcomes({ ...range, level: "ad" });
    expect(r.rows[0]).toMatchObject({ adId: "a1", spend: 500, platformLeads: 3, funded: null, leads: null, outcomes: "platform_only" });
    expect(r.notes.join(" ")).toMatch(/ad id/i);
  });

  it("ad level with ad ids on leads: CRM outcomes by ad", async () => {
    const leads: AdLead[] = [
      { adKey: "a1", kycApproved: true, funded: true, revenue: 300 },
      { adKey: "a1", kycApproved: false, funded: false, revenue: 0 },
      { adKey: "zzz", kycApproved: true, funded: true, revenue: 9 },
    ];
    const r = await createSimpleOutcomeProvider({ ...deps, loadAdLeads: async () => leads }).getOutcomes({ ...range, level: "ad" });
    expect(r.rows[0]).toMatchObject({ adId: "a1", leads: 2, kyc: 1, funded: 1, revenue: 300, outcomes: "crm" });
  });

  it("an unconnected channel contributes nothing", async () => {
    const r = await createSimpleOutcomeProvider({ ...deps, loadReports: async () => [{ channel: "google" as const, report: null, asOf: null }] }).getOutcomes({ ...range, level: "campaign" });
    expect(r.rows).toEqual([]);
    expect(r.asOf).toBeNull();
  });
});

describe("attributeLeadsToAds", () => {
  const ads = [{ adId: "a1", adName: "Ad one" }, { adId: "a2", adName: "Ad two" }];
  it("matches ad_id first, then utm_content by id or by name", () => {
    const rows = attributeLeadsToAds(
      [
        { attribution: { ad_id: "a1" }, kycApproved: true, funded: true, revenue: 10 },
        { attribution: { utm_content: "a2" }, kycApproved: false, funded: false, revenue: 0 },
        { attribution: { utm_content: "ad two" }, kycApproved: true, funded: false, revenue: 0 },
        { attribution: { utm_content: "nope" }, kycApproved: true, funded: true, revenue: 99 },
        { attribution: null, kycApproved: true, funded: true, revenue: 99 },
      ],
      ads,
    );
    expect(rows).toEqual([
      { adKey: "a1", kycApproved: true, funded: true, revenue: 10 },
      { adKey: "a2", kycApproved: false, funded: false, revenue: 0 },
      { adKey: "a2", kycApproved: true, funded: false, revenue: 0 },
    ]);
  });
  it("an ambiguous name matches nothing", () => {
    const dup = [{ adId: "a1", adName: "Same" }, { adId: "a2", adName: "Same" }];
    expect(attributeLeadsToAds([{ attribution: { utm_content: "same" }, kycApproved: true, funded: true, revenue: 1 }], dup)).toEqual([]);
  });
});
