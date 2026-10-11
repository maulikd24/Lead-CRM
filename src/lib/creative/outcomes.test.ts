import { describe, expect, it } from "vitest";

import { createFakeOutcomeProvider } from "@/lib/attribution/outcome-provider.testkit";
import type { CreativeReport, CreativeRow } from "@/lib/marketing/creatives";

import { joinAdOutcomes } from "./outcomes";

/**
 * Creative reads campaign outcomes ONLY through the canonical CampaignOutcomeProvider (lib/attribution). What it adds is the platform's delivery
 * per ad (impressions, clicks). These tests pin that the join carries the provider's numbers through unchanged: the same funded customers, the
 * same cost per funded customer, the same revenue, for the same fixture the Campaign impact tab and the director report use.
 */
let n = 0;
const lead = (campaign: string, creative: string | null, over: Record<string, unknown> = {}) => ({
  clientId: `c${++n}`, name: `Customer ${n}`, rmId: null, rmName: null, stage: "New Lead", createdAt: new Date("2027-03-10T05:00:00Z"), leadMonth: "2027-03",
  group: { key: campaign, label: campaign === "google:9" ? "NRI Search" : "Retirement", kind: "campaign" as const }, creative, confidence: "high" as const,
  contact: "in_sla" as const, firstContactMinutes: 5, kycApproved: false, funded: false, revenue: 0, revenueByMonth: {}, ...over,
});
const many = (k: number, campaign: string, creative: string | null, over: Record<string, unknown> = {}) => Array.from({ length: k }, () => lead(campaign, creative, over));

const fixture = {
  clients: [
    ...many(6, "google:9", "Ad one"),
    lead("google:9", "Ad one", { funded: true, revenue: 6000 }),
    lead("google:9", "Ad one", { funded: true, revenue: 4000 }),
    ...many(3, "google:9", "Ad two"),
    ...many(2, "meta:111", "Carousel A"),
  ],
  spend: [
    { key: "google:9", label: "NRI Search", channel: "google" as const, spend: 3000, currency: "INR", creatives: [{ name: "Ad one", spend: 2000 }, { name: "Ad two", spend: 1000 }] },
    { key: "meta:111", label: "Retirement", channel: "meta" as const, spend: 500, currency: "INR", creatives: [{ name: "Carousel A", spend: 500 }] },
  ],
};
const adRow = (adId: string, adName: string, over: Partial<CreativeRow> = {}): CreativeRow => ({ channel: "google", adId, adName, format: "RESPONSIVE_SEARCH_AD", campaignId: "9", campaignName: "NRI Search", spend: 0, impressions: 10_000, clicks: 200, leads: 9, days: 20, ctr: 0.02, cpc: 10, cpl: 100, verdict: null, ...over });
const delivery = (ads: CreativeRow[]): CreativeReport => ({ currency: "INR", ads, totals: { ads: ads.length, spend: 0, impressions: 0, clicks: 0, leads: 0, ctr: null, cpl: null }, otherCurrencyRows: 0 });
const report = () => createFakeOutcomeProvider(fixture).outcomes({ grain: "ad", period: { from: "2027-03-22", to: "2027-04-20" } }, { kind: "system", consumer: "creative" });

describe("joinAdOutcomes: the provider's numbers, unchanged", () => {
  it("an ad carries the provider's funded customers, revenue and cost per funded customer, and the platform's impressions and clicks", async () => {
    const out = joinAdOutcomes(await report(), delivery([adRow("a1", "Ad one"), adRow("a2", "Ad two")]));
    const one = out.rows.find((r) => r.adId === "a1")!;
    expect(one).toMatchObject({ channel: "google", adName: "Ad one", leads: 8, funded: 2, revenue: 10000, spend: 2000, currency: "INR", impressions: 10_000, clicks: 200, platformLeads: 9, outcomes: "crm" });
    expect(one.costPerFunded).toBe(1000);
  });
  it("is identical to what the provider itself says for that ad (equivalence)", async () => {
    const rep = await report();
    const out = joinAdOutcomes(rep, delivery([adRow("a1", "Ad one"), adRow("a2", "Ad two")]));
    for (const row of out.rows) {
      const canon = rep.rows.find((r) => r.key === `google:9::${row.adName}`)!;
      expect({ spend: row.spend, leads: row.leads, funded: row.funded, revenue: row.revenue, costPerFunded: row.costPerFunded }).toEqual({ spend: canon.spend, leads: canon.leads, funded: canon.funded, revenue: canon.revenue, costPerFunded: canon.costPerFunded });
    }
  });
  it("an ad with spend and nobody funded has no cost per funded customer, not zero", async () => {
    const out = joinAdOutcomes(await report(), delivery([adRow("a2", "Ad two")]));
    expect(out.rows[0]).toMatchObject({ funded: 0, costPerFunded: null });
  });
  it("matches an ad by channel, campaign and name, so the same name in another campaign never borrows its numbers", async () => {
    const out = joinAdOutcomes(await report(), delivery([adRow("a1", "Ad one", { campaignId: "777" })]));
    expect(out.rows[0]).toMatchObject({ funded: 0, leads: 0 });
  });
  it("KYC is not computed per ad: it is null, never a guess", async () => {
    const out = joinAdOutcomes(await report(), delivery([adRow("a1", "Ad one")]));
    expect(out.rows[0].kyc).toBeNull();
  });
  it("when no lead carries an ad at all, ads show the platform's own numbers only and say why", async () => {
    const bare = await createFakeOutcomeProvider({ clients: [lead("google:9", null)], spend: fixture.spend }).outcomes({ grain: "ad", period: { from: "2027-03-22", to: "2027-04-20" } }, { kind: "system", consumer: "creative" });
    const out = joinAdOutcomes(bare, delivery([adRow("a1", "Ad one")]));
    expect(out.rows[0]).toMatchObject({ outcomes: "platform_only", leads: null, funded: null, revenue: null, costPerFunded: null, platformLeads: 9 });
    expect(out.notes.join(" ")).toMatch(/ad id|utm_content/i);
  });
  it("carries the provider's notes and the freshest spend sync as the data age", async () => {
    const out = joinAdOutcomes(await report(), delivery([adRow("a1", "Ad one")]));
    expect(out.asOf).toBe("2027-04-20T02:00:00.000Z");
    expect(out.currency).toBe("INR");
  });
  it("makes no number of its own: spend, funded and cost per funded customer are all the provider's", async () => {
    const rep = await report();
    const out = joinAdOutcomes({ ...rep, rows: rep.rows.map((r) => (r.grain === "ad" ? { ...r, funded: 41, spend: 777, costPerFunded: 3 } : r)) }, delivery([adRow("a1", "Ad one")]));
    expect(out.rows[0]).toMatchObject({ funded: 41, spend: 777, costPerFunded: 3 });
  });
});
