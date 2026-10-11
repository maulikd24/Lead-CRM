import { describe, expect, it } from "vitest";

import { OutcomeAccessError, type CampaignOutcomeProvider } from "@/lib/attribution";
import { createFakeOutcomeProvider } from "@/lib/attribution/outcome-provider.testkit";
import type { ImpactClient, SpendInput } from "@/lib/attribution/impact";

import { campaignOptions, funnelEstimateFor, loadChannelHistory, planOutcomeFor, PLANNER_CALLER, historyPeriod } from "./outcomes";

let n = 0;
const client = (over: Partial<ImpactClient> = {}): ImpactClient => ({
  clientId: `c${++n}`, name: `Customer ${n}`, rmId: "rm1", rmName: "RM", stage: "New Lead", createdAt: new Date("2027-03-10T05:00:00Z"), leadMonth: "2027-03",
  group: { key: "meta:111", label: "Retirement Planning", kind: "campaign" }, creative: "A", confidence: "high",
  contact: "in_sla", firstContactMinutes: 8, kycApproved: false, funded: false, revenue: 0, revenueByMonth: {}, ...over,
});
const many = (k: number, over: Partial<ImpactClient> = {}) => Array.from({ length: k }, () => client(over));
const spend: SpendInput[] = [
  { key: "meta:111", label: "Retirement Planning", channel: "meta", spend: 10000, currency: "INR", creatives: [] },
  { key: "meta:222", label: "Tax Saving", channel: "meta", spend: 4000, currency: "INR", creatives: [] },
  { key: "google:9", label: "NRI Search", channel: "google", spend: 3000, currency: "INR", creatives: [] },
];
const clients: ImpactClient[] = [
  ...many(30, { kycApproved: true }),
  ...many(10, { kycApproved: true, funded: true, revenue: 100 }),
  ...many(20, { group: { key: "meta:222", label: "Tax Saving", kind: "campaign" } }),
  ...many(5, { group: { key: "google:9", label: "NRI Search", kind: "campaign" }, funded: true }),
  ...many(40, { group: { key: "referral_code", label: "Referral codes", kind: "source" }, kycApproved: true }),
];
const provider = createFakeOutcomeProvider({ clients, spend });
const TODAY = "2027-04-20";

describe("history comes only from the CampaignOutcomeProvider", () => {
  it("pools the synced Meta campaigns for a click-to-WhatsApp plan, with budgets from spend", async () => {
    const h = await loadChannelHistory(provider, "click_to_whatsapp", TODAY);
    expect(h.status).toBe("ok");
    if (h.status !== "ok") return;
    expect(h.rows.reduce((a, r) => a + r.leads, 0)).toBe(60);
    expect(h.rows.reduce((a, r) => a + r.funded, 0)).toBe(10);
    expect(h.rows.map((r) => r.budgetInr as number).sort((a, b) => a - b)).toEqual([4000, 10000]);
    expect(h.source.provider).toBe("fake");
    expect(h.source.period.to).toBe(TODAY);
    expect(h.source.spend.map((s) => s.status)).toEqual(["fresh", "fresh"]);
  });
  it("search ads read the Google campaigns, referrals read the referral bucket", async () => {
    const g = await loadChannelHistory(provider, "search_ad", TODAY);
    expect(g.status === "ok" && g.rows.reduce((a, r) => a + r.leads, 0)).toBe(5);
    const r = await loadChannelHistory(provider, "referral_community", TODAY);
    expect(r.status === "ok" && r.rows.reduce((a, x) => a + x.leads, 0)).toBe(40);
  });
  it("a channel the provider does not measure separately is said so, never guessed", async () => {
    for (const ch of ["email", "short_video"] as const) {
      const h = await loadChannelHistory(provider, ch, TODAY);
      expect(h.status).toBe("not_measured");
    }
  });
  it("a refused or failing provider is reported as unavailable, never a crash and never a number", async () => {
    const refusing: CampaignOutcomeProvider = { name: "x", outcomes: async () => { throw new OutcomeAccessError(); }, leadCohorts: async () => { throw new OutcomeAccessError(); } };
    const h = await loadChannelHistory(refusing, "click_to_whatsapp", TODAY);
    expect(h.status).toBe("unavailable");
    const est = await funnelEstimateFor(refusing, { channel: "click_to_whatsapp", budgetInr: 5000 }, TODAY);
    expect(est.estimate.status).toBe("unavailable");
  });
  it("reads as the registered planner consumer", () => {
    expect(PLANNER_CALLER).toEqual({ kind: "system", consumer: "planner" });
  });
  it("looks back 180 days", () => {
    expect(historyPeriod("2027-04-20")).toEqual({ from: "2026-10-23", to: "2027-04-20" });
  });
});

describe("funnel estimate ranges", () => {
  it("returns ranges from our own history", async () => {
    const e = await funnelEstimateFor(provider, { channel: "click_to_whatsapp", budgetInr: 7000 }, TODAY);
    expect(e.estimate.status).toBe("ok");
    if (e.estimate.status === "ok") {
      expect(e.estimate.observed).toEqual({ leads: 60, kyc: 40, funded: 10 });
      expect(e.estimate.rates.funded.low).toBeLessThan(10 / 60);
      expect(e.estimate.rates.funded.high).toBeGreaterThan(10 / 60);
    }
    expect(e.source?.asOf).toBeTruthy();
  });
  it("says not enough data below 30 past leads", async () => {
    const e = await funnelEstimateFor(provider, { channel: "search_ad", budgetInr: 7000 }, TODAY);
    expect(e.estimate.status).toBe("not_enough_data");
  });
  it("says not measured for email", async () => {
    const e = await funnelEstimateFor(provider, { channel: "email", budgetInr: 7000 }, TODAY);
    expect(e.estimate.status).toBe("not_measured");
  });
});

describe("a plan's own outcomes and the campaign picker", () => {
  it("reads the linked campaign row, with its confidence", async () => {
    const o = await planOutcomeFor(provider, "meta:111", TODAY);
    expect(o.status).toBe("ok");
    if (o.status === "ok") expect(o.row).toMatchObject({ leads: 40, kyc: 40, funded: 10, spend: 10000 });
    if (o.status === "ok") expect(o.row.confidence.label).toBeDefined();
  });
  it("no link means not measured, an unknown key means not found", async () => {
    expect((await planOutcomeFor(provider, null, TODAY)).status).toBe("not_linked");
    expect((await planOutcomeFor(provider, "meta:999", TODAY)).status).toBe("not_found");
  });
  it("lists the synced campaigns to link a plan to", async () => {
    const opts = await campaignOptions(provider, TODAY);
    expect(opts.map((o) => o.key).sort()).toEqual(["google:9", "meta:111", "meta:222"]);
  });
});
