import { describe, expect, it } from "vitest";

import { createFakeOutcomeProvider } from "@/lib/attribution/outcome-provider.testkit";
import type { ImpactClient, SpendInput } from "@/lib/attribution/impact";

import { totalsByCampaign } from "./derive";
import { demoSnapshot } from "./fixture.testkit";
import { outcomeOf, campaignIdOfKey } from "./store";
import { runRules, type Rule } from "./rules";
import type { AutopilotSnapshot } from "./types";

/**
 * Equivalence: the numbers Autopilot shows for a campaign (cost per funded customer, return on spend, funded, KYC, revenue) are the numbers the
 * CampaignOutcomeProvider reports for the same customers and spend, to the last digit. The provider here is the real one over an in-memory source.
 */
const snap = demoSnapshot();
const channelOf = (id: string) => (snap.campaigns.find((c) => c.id === id)?.platform ?? "meta");

function clientsOf(s: AutopilotSnapshot): ImpactClient[] {
  return s.leads.map((l, i) => {
    const at = new Date(l.arrivedAt);
    return {
      clientId: `c${i}`, name: "", rmId: null, rmName: null, stage: "Lead", createdAt: at, leadMonth: l.arrivedAt.slice(0, 7),
      group: l.campaignId ? { key: `${channelOf(l.campaignId)}:${l.campaignId}`, label: l.campaignId, kind: "campaign" } : { key: "unattributed", label: "Unattributed", kind: "unattributed" },
      creative: null, confidence: "high", contact: l.contactMinutes === null ? "missed" : l.contactMinutes <= s.settings.contactSlaMinutes ? "in_sla" : "late", firstContactMinutes: l.contactMinutes,
      kycApproved: l.kycComplete, funded: l.funded, revenue: l.revenue, revenueByMonth: { [l.arrivedAt.slice(0, 7)]: l.revenue }, city: l.city, state: l.state, aum: l.aum,
    };
  });
}
const spendOf = (s: AutopilotSnapshot): SpendInput[] =>
  s.campaigns.map((c) => ({ key: `${c.platform}:${c.id}`, label: c.name, channel: c.platform, currency: "INR", creatives: [], spend: s.days.filter((d) => d.campaignId === c.id).reduce((a, d) => a + d.spend, 0) }));

const provider = createFakeOutcomeProvider({ clients: clientsOf(snap), spend: spendOf(snap) });
const caller = { kind: "system", consumer: "autopilot" } as const;
const period = { from: snap.window.since, to: snap.window.until };

describe("Autopilot's campaign numbers equal the provider's", () => {
  it("cost per funded customer and return on spend, per campaign, to the last digit", async () => {
    const report = await provider.outcomes({ grain: "campaign", period }, caller);
    const fromProvider = Object.fromEntries(report.rows.filter((r) => r.rowKind === "campaign").map((r) => [campaignIdOfKey(r.key), outcomeOf(r)]));
    const s: AutopilotSnapshot = { ...snap, outcomes: fromProvider };
    const totals = totalsByCampaign(s);
    expect(totals.length).toBe(snap.campaigns.length);
    for (const t of totals) {
      const row = report.rows.find((r) => campaignIdOfKey(r.key) === t.campaign.id)!;
      expect(t.costPerFunded, `${t.campaign.id} cost per funded`).toBe(row.costPerFunded);
      expect(t.roas, `${t.campaign.id} roas`).toBe(row.roas);
      expect(t.funded).toBe(row.funded);
      expect(t.crmLeads).toBe(row.leads);
      expect(t.kyc).toBe(row.kyc ?? 0);
      expect(t.revenue).toBe(row.revenue);
    }
    expect(totals.some((t) => t.costPerFunded !== null && t.roas !== null)).toBe(true);
  });

  it("the synthetic fixture's stand-in outcomes are exactly what the provider returns (so tests on the fixture mean the same thing)", async () => {
    const report = await provider.outcomes({ grain: "campaign", period }, caller);
    for (const r of report.rows.filter((x) => x.rowKind === "campaign")) {
      const mine = snap.outcomes[campaignIdOfKey(r.key)];
      expect(mine.funded).toBe(r.funded);
      expect(mine.leads).toBe(r.leads);
      expect(mine.costPerFunded).toBe(r.costPerFunded);
      expect(mine.roas).toBe(r.roas);
    }
  });

  it("a rule over a window reads the provider's cost per funded customer for that window, not its own", () => {
    const rule: Rule = { id: "r1", name: "Pause expensive", enabled: true, metric: "cost_per_funded", op: ">", threshold: 1, days: 28, campaignIds: null, accountIds: null, action: "pause_campaign" };
    const planted: AutopilotSnapshot = { ...snap, windowOutcomes: { "28": { m1: { ...snap.outcomes.m1, leads: 50, costPerFunded: 12_345, funded: 5, spend: 61_725 } } } };
    const run = runRules(planted, [rule]);
    const m1 = run.outcomes.find((o) => o.campaignId === "m1")!;
    expect(m1.value).toBe(12_345);
  });

  it("lead cohorts carry no way back to a customer and are blurred unless a signed-in ADMIN asks", async () => {
    const asAdmin = await provider.leadCohorts({ period }, { kind: "user", id: "u1", role: "ADMIN" });
    const asMarketing = await provider.leadCohorts({ period }, { kind: "user", id: "u2", role: "MARKETING" });
    const asSystem = await provider.leadCohorts({ period }, caller);
    expect(asAdmin.blurred).toBe(false);
    expect(asMarketing.blurred).toBe(true);
    expect(asSystem.blurred).toBe(true);
    for (const r of [...asAdmin.rows, ...asMarketing.rows]) expect(Object.keys(r).sort()).toEqual(["aum", "arrivedAt", "campaignKey", "channel", "city", "firstContactMinutes", "funded", "kyc", "revenue", "state"].sort());
    expect(asMarketing.rows.every((r) => r.arrivedAt.endsWith(":00:00.000Z"))).toBe(true);
    expect(asMarketing.rows.every((r) => r.firstContactMinutes === null || r.firstContactMinutes % 5 === 0)).toBe(true);
    expect(asAdmin.rows.some((r) => !r.arrivedAt.endsWith(":00:00.000Z"))).toBe(true);
    // The counts of funded customers and KYC do not change with the blur: the blur never alters a fact, only how precisely a time or an amount is shown.
    expect(asMarketing.rows.filter((r) => r.funded).length).toBe(asAdmin.rows.filter((r) => r.funded).length);
    expect(asMarketing.rows.length).toBe(asAdmin.rows.length);
  });

  it("refuses a caller that is not ADMIN, MARKETING or a registered system reader, before any data is read", async () => {
    await expect(provider.leadCohorts({ period }, { kind: "user", id: "u", role: "RM" })).rejects.toThrow(/Not allowed/);
    await expect(provider.leadCohorts({ period }, { kind: "system", consumer: "nobody" as never })).rejects.toThrow(/registered/);
    await expect(provider.outcomes({ grain: "campaign", period }, { kind: "user", id: "u", role: "MANAGER" })).rejects.toThrow(/Not allowed/);
  });
});
