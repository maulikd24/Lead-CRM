import { describe, expect, it } from "vitest";

import { createFakeOutcomeProvider } from "@/lib/attribution/outcome-provider.testkit";
import type { ImpactClient, SpendInput } from "@/lib/attribution/impact";

import { loadCampaignFunnel, periodEndingOn } from "./outcomes";

let n = 0;
const client = (over: Partial<ImpactClient> = {}): ImpactClient => ({
  clientId: `c${++n}`, name: `Customer ${n}`, rmId: "rm1", rmName: "Karan Mehta", stage: "New Lead", createdAt: new Date("2027-04-10T05:00:00Z"), leadMonth: "2027-04",
  group: { key: "meta:111", label: "Retirement Planning", kind: "campaign" }, creative: null, confidence: "high", contact: "in_sla", firstContactMinutes: 8, kycApproved: false, funded: false, revenue: 0, revenueByMonth: {}, ...over,
});
const spend: SpendInput[] = [{ key: "meta:111", label: "Retirement Planning", channel: "meta", spend: 10000, currency: "INR", creatives: [] }];
const NOW = new Date("2027-04-20T06:00:00Z");
const clients = [...Array.from({ length: 10 }, () => client({ kycApproved: true })), client({ kycApproved: true, funded: true, revenue: 5000 }), client({ kycApproved: true, funded: true, revenue: 2000 })];
const provider = createFakeOutcomeProvider({ clients, spend, now: NOW });

describe("the closed loop's campaign table is the shared outcome numbers", () => {
  it("funded, leads and confidence are exactly the provider's (one definition of funded)", async () => {
    const direct = await provider.outcomes({ grain: "campaign", period: periodEndingOn(NOW, 90) }, { kind: "system", consumer: "closed-loop" });
    const view = await loadCampaignFunnel(provider, NOW);
    expect(view.supported).toBe(true);
    const campaign = direct.rows.find((r) => r.rowKind === "campaign")!;
    expect(view.rows).toEqual([{ key: campaign.key, label: "Retirement Planning", leads: campaign.leads, kyc: campaign.kyc, funded: campaign.funded, confidence: campaign.confidence.label }]);
    expect(view.rows[0].funded).toBe(2);
    expect(view.totals).toEqual({ leads: direct.totals!.leads, funded: direct.totals!.funded });
  });
  it("shows no spend, cost or revenue figure at all (this screen is about consent, not money)", async () => {
    const view = await loadCampaignFunnel(provider, NOW);
    expect(JSON.stringify(view)).not.toMatch(/spend|cost|revenue|roas|10000|7000/i);
  });
  it("only campaigns are listed (partner, referral and unattributed buckets are not ad campaigns)", async () => {
    const mixed = createFakeOutcomeProvider({ clients: [...clients, client({ group: { key: "partner_code", label: "Partner codes", kind: "source" }, funded: true })], spend, now: NOW });
    expect((await loadCampaignFunnel(mixed, NOW)).rows.map((r) => r.key)).toEqual(["meta:111"]);
  });
  it("is read as the registered closed-loop consumer, never as a person", async () => {
    const seen: unknown[] = [];
    const spy = { name: "spy", outcomes: async (_q: unknown, caller: unknown) => { seen.push(caller); return provider.outcomes({ grain: "campaign", period: periodEndingOn(NOW, 90) }, { kind: "system", consumer: "closed-loop" }); } };
    await loadCampaignFunnel(spy as never, NOW);
    expect(seen).toEqual([{ kind: "system", consumer: "closed-loop" }]);
  });
  it("a window of N days ends today and starts N-1 days earlier (inclusive, YYYY-MM-DD)", () => {
    expect(periodEndingOn(NOW, 90)).toEqual({ from: "2027-01-21", to: "2027-04-20" });
  });
});
