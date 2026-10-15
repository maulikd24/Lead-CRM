import { describe, expect, it } from "vitest";

import { createFakeOutcomeProvider } from "@/lib/attribution/outcome-provider.testkit";

import { periodFromOutcomes } from "./period";

/**
 * The director report's channel and campaign numbers ARE the CampaignOutcomeProvider's. This file maps one OutcomeReport into the report's
 * period shape and adds nothing: no customer query, no attribution rule, no cost or return arithmetic of its own.
 */
let n = 0;
const lead = (key: string, label: string, kind: "campaign" | "source", over: Record<string, unknown> = {}) => ({
  clientId: `c${++n}`, name: `Customer ${n}`, rmId: null, rmName: null, stage: "New Lead", createdAt: new Date("2027-03-10T05:00:00Z"), leadMonth: "2027-03",
  group: { key, label, kind }, creative: null, confidence: "high" as const, contact: "in_sla" as const, firstContactMinutes: 5, kycApproved: false, funded: false, revenue: 0, revenueByMonth: {}, ...over,
});
const fixture = {
  clients: [
    ...Array.from({ length: 5 }, () => lead("meta:111", "Retirement", "campaign", { kycApproved: true })),
    lead("meta:111", "Retirement", "campaign", { funded: true, kycApproved: true, revenue: 8000 }),
    lead("meta:111", "Retirement", "campaign", { funded: true, kycApproved: true, revenue: 2000 }),
    lead("google:9", "NRI Search", "campaign"),
    lead("partner_code", "Partner codes", "source", { funded: true, revenue: 300 }),
    lead("referral_code", "Referral codes", "source"),
    lead("form", "Website forms", "source", { funded: true, revenue: 99 }),
  ],
  spend: [
    { key: "meta:111", label: "Retirement", channel: "meta" as const, spend: 10000, currency: "INR", creatives: [] },
    { key: "google:9", label: "NRI Search", channel: "google" as const, spend: 3000, currency: "INR", creatives: [] },
  ],
};
const period = { from: "2027-03-22", to: "2027-04-20" };
const report = () => createFakeOutcomeProvider(fixture).outcomes({ grain: "campaign", period }, { kind: "system", consumer: "director-reports" });
const on = { referral: true, partner: true };

describe("periodFromOutcomes", () => {
  it("channels carry the provider's totals, cost per funded customer and return", async () => {
    const rep = await report();
    const p = periodFromOutcomes({ ...period, report: rep, programmes: on });
    const meta = p.channels.find((c) => c.channel === "meta")!;
    expect(meta).toMatchObject({ available: true, spend: 10000, leads: 7, kyc: 7, funded: 2, revenue: 10000 });
    expect(meta.costPerFunded).toBe(rep.byChannel.find((c) => c.channel === "meta")!.costPerFunded);
    expect(meta.costPerFunded).toBe(5000);
    expect(meta.roas).toBe(1);
  });
  it("the paid total is the provider's, not a sum of ratios", async () => {
    const rep = await report();
    const p = periodFromOutcomes({ ...period, report: rep, programmes: on });
    expect(p.paid).toEqual({ costPerFunded: rep.paid.costPerFunded, roas: rep.paid.roas });
  });
  it("campaigns are the provider's campaign rows (not source buckets), with their funded and revenue", async () => {
    const p = periodFromOutcomes({ ...period, report: await report(), programmes: on });
    expect(p.campaigns.map((c) => c.campaignId).sort()).toEqual(["111", "9"]);
    expect(p.campaigns.find((c) => c.campaignId === "111")).toMatchObject({ channel: "meta", name: "Retirement", spend: 10000, leads: 7, funded: 2, revenue: 10000 });
  });
  it("partner and referral are unavailable when their programme is switched off, even if the provider has rows", async () => {
    const p = periodFromOutcomes({ ...period, report: await report(), programmes: { referral: false, partner: true } });
    expect(p.channels.find((c) => c.channel === "referral")).toMatchObject({ available: false, funded: null, leads: null });
    expect(p.channels.find((c) => c.channel === "partner")!.available).toBe(true);
  });
  it("data age is the last successful spend sync per ad channel; partner and referral have none", async () => {
    const p = periodFromOutcomes({ ...period, report: await report(), programmes: on });
    expect(p.asOf).toEqual({ meta: "2027-04-20T02:00:00.000Z", google: "2027-04-20T02:00:00.000Z", referral: null, partner: null });
  });
  it("keeps the provider's notes and says how a customer is counted (once, by first touch)", async () => {
    const p = periodFromOutcomes({ ...period, report: await report(), programmes: on });
    expect(p.notes.join(" ")).toMatch(/counted once/i);
    expect(p.currency).toBe("INR");
  });
  it("no person appears anywhere in the period", async () => {
    expect(JSON.stringify(periodFromOutcomes({ ...period, report: await report(), programmes: on }))).not.toMatch(/Customer \d|"c\d+"/);
  });
});
