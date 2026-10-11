import { describe, expect, it } from "vitest";

import { buildImpact } from "@/lib/attribution/impact";
import { createFakeOutcomeProvider, type OutcomeFixture } from "@/lib/attribution/outcome-provider.testkit";
import { joinAdOutcomes } from "@/lib/creative/outcomes";
import type { CreativeReport, CreativeRow } from "@/lib/marketing/creatives";

import { periodFromOutcomes } from "./period";
import { buildDirectorReport } from "./report";

/**
 * D11, the contract: ONE seeded fixture, and every module that shows marketing outcomes (the Campaign impact tab's model, the provider, creative
 * intelligence, the director report) reports the SAME funded customers, leads, revenue, cost per funded customer and return for it. A module
 * that attributes or divides on its own makes this fail.
 */
let n = 0;
const c = (key: string, label: string, kind: "campaign" | "source", creative: string | null, over: Record<string, unknown> = {}) => ({
  clientId: `c${++n}`, name: `P${n}`, rmId: null, rmName: null, stage: "New Lead", createdAt: new Date("2027-03-10T05:00:00Z"), leadMonth: "2027-03",
  group: { key, label, kind }, creative, confidence: "high" as const, contact: "in_sla" as const, firstContactMinutes: 5, kycApproved: false, funded: false, revenue: 0, revenueByMonth: {}, ...over,
});
const fixture: OutcomeFixture = {
  clients: [
    ...Array.from({ length: 6 }, () => c("meta:111", "Retirement", "campaign", "Reel A", { kycApproved: true })),
    c("meta:111", "Retirement", "campaign", "Reel A", { funded: true, kycApproved: true, revenue: 9000 }),
    c("meta:111", "Retirement", "campaign", "Reel B", { funded: true, kycApproved: true, revenue: 3000 }),
    c("meta:222", "Demat", "campaign", "Reel C"),
    c("google:9", "NRI Search", "campaign", "Ad one", { funded: true, revenue: 1200 }),
    c("google:9", "NRI Search", "campaign", "Ad one"),
    c("partner_code", "Partner codes", "source", null, { funded: true, revenue: 100 }),
    c("form", "Website forms", "source", null),
  ] as never,
  spend: [
    { key: "meta:111", label: "Retirement", channel: "meta", spend: 6000, currency: "INR", creatives: [{ name: "Reel A", spend: 4000 }, { name: "Reel B", spend: 2000 }] },
    { key: "meta:222", label: "Demat", channel: "meta", spend: 1000, currency: "INR", creatives: [{ name: "Reel C", spend: 1000 }] },
    { key: "google:9", label: "NRI Search", channel: "google", spend: 2000, currency: "INR", creatives: [{ name: "Ad one", spend: 2000 }] },
  ],
};
const period = { from: "2027-03-22", to: "2027-04-20" };
const ad = (channel: "meta" | "google", campaignId: string, adName: string): CreativeRow => ({ channel, adId: `id-${adName}`, adName, format: "VIDEO", campaignId, campaignName: campaignId, spend: 0, impressions: 100, clicks: 5, leads: 1, days: 20, ctr: 0.05, cpc: 1, cpl: 1, verdict: null });
const delivery = (ads: CreativeRow[]): CreativeReport => ({ currency: "INR", ads, totals: { ads: ads.length, spend: 0, impressions: 0, clicks: 0, leads: 0, ctr: null, cpl: null }, otherCurrencyRows: 0 });

describe("every module agrees on funded customers, leads, revenue and cost for one fixture", async () => {
  const provider = createFakeOutcomeProvider(fixture);
  const campaign = await provider.outcomes({ grain: "campaign", period }, { kind: "system", consumer: "director-reports" });
  const adGrain = await provider.outcomes({ grain: "ad", period }, { kind: "system", consumer: "creative" });
  const impact = buildImpact({ clients: fixture.clients, spend: fixture.spend, slaMinutes: 15, currency: "INR" });
  const director = periodFromOutcomes({ ...period, report: campaign, programmes: { referral: true, partner: true } });
  const creative = joinAdOutcomes(adGrain, delivery([ad("meta", "111", "Reel A"), ad("meta", "111", "Reel B"), ad("meta", "222", "Reel C"), ad("google", "9", "Ad one")]));

  it("the provider's totals are the Campaign impact model's totals", () => {
    expect(campaign.totals).toMatchObject({ leads: impact.totals.leads, funded: impact.totals.funded, revenue: impact.totals.revenue, spend: impact.totals.spend, costPerLead: impact.totals.cpl, roas: impact.totals.roas });
  });
  it("every campaign's funded, leads, spend and cost per funded customer are identical in the provider and the impact model", () => {
    for (const row of impact.rows.filter((r) => r.kind === "campaign")) {
      const p = campaign.rows.find((r) => r.key === row.key)!;
      expect({ leads: p.leads, funded: p.funded, revenue: p.revenue, spend: p.spend, cpl: p.costPerLead, cpf: p.costPerFunded }).toEqual({ leads: row.leads, funded: row.funded, revenue: row.revenue, spend: row.spend, cpl: row.cpl, cpf: row.costPerFunded });
    }
  });
  it("the director report's campaigns carry the same funded and revenue as the provider's rows", () => {
    for (const k of director.campaigns) {
      const p = campaign.rows.find((r) => r.key === `${k.channel}:${k.campaignId}`)!;
      expect({ leads: k.leads, funded: k.funded, revenue: k.revenue, spend: k.spend }).toEqual({ leads: p.leads, funded: p.funded, revenue: p.revenue, spend: p.spend });
    }
  });
  it("the director report's channel totals add up to the provider's report, and its cost per funded customer is the provider's", () => {
    const r = buildDirectorReport({ current: director, previous: null, generatedAt: "2027-04-21T00:00:00Z" });
    const funded = r.channels.reduce((a, ch) => a + (ch.current.funded ?? 0), 0);
    expect(funded).toBe(campaign.byChannel.reduce((a, ch) => a + (ch.funded ?? 0), 0));
    expect(r.totals.current.costPerFunded).toBe(campaign.paid.costPerFunded);
    expect(r.totals.current.roas).toBe(campaign.paid.roas);
    expect(r.channels.find((ch) => ch.channel === "meta")!.current.costPerFunded).toBe(campaign.byChannel.find((ch) => ch.channel === "meta")!.costPerFunded);
  });
  it("creative's ads carry the same funded customers as the provider's ad rows, summing to each campaign's funded", () => {
    const meta111 = creative.rows.filter((r) => r.channel === "meta" && r.campaignId === "111");
    expect(meta111.reduce((a, r) => a + (r.funded ?? 0), 0)).toBe(campaign.rows.find((r) => r.key === "meta:111")!.funded);
    expect(creative.rows.find((r) => r.adName === "Ad one")).toMatchObject({ funded: 1, revenue: 1200, spend: 2000, costPerFunded: 2000 });
  });
  it("funded customers across the three views are the same number", () => {
    const fromCreative = creative.rows.reduce((a, r) => a + (r.funded ?? 0), 0);
    const fromDirector = director.campaigns.reduce((a, k) => a + (k.funded ?? 0), 0);
    const fromImpact = impact.rows.filter((r) => r.kind === "campaign").reduce((a, r) => a + r.funded, 0);
    expect(fromCreative).toBe(fromImpact);
    expect(fromDirector).toBe(fromImpact);
  });
});
