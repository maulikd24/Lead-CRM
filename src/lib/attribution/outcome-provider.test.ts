import { describe, expect, it } from "vitest";

import { buildImpact, type ImpactClient, type SpendFreshness, type SpendInput } from "./impact";
import {
  CONFIDENCE_DEFAULTS, OUTCOME_CONSUMERS, OUTCOME_DEFINITIONS, OutcomeAccessError, createOutcomeProvider, labelConfidence, type OutcomeSource, type OutcomeCaller,
} from "./outcome-provider";

const d = (iso: string) => new Date(iso);
let n = 0;
const client = (over: Partial<ImpactClient> = {}): ImpactClient => ({
  clientId: `c${++n}`, name: `Customer ${n}`, rmId: "rm1", rmName: "Karan Mehta", stage: "New Lead", createdAt: d("2027-03-10T05:00:00Z"), leadMonth: "2027-03",
  group: { key: "meta:111", label: "Retirement Planning", kind: "campaign" }, creative: "Carousel A", confidence: "high",
  contact: "in_sla", firstContactMinutes: 8, kycApproved: false, funded: false, revenue: 0, revenueByMonth: {}, ...over,
});
const spend: SpendInput[] = [
  { key: "meta:111", label: "Retirement Planning", channel: "meta", spend: 10000, currency: "INR", creatives: [{ name: "Carousel A", spend: 6000 }] },
  { key: "google:9", label: "NRI Search", channel: "google", spend: 3000, currency: "INR", creatives: [{ name: "Ad 1", spend: 1000 }] },
];
const many = (k: number, over: Partial<ImpactClient> = {}) => Array.from({ length: k }, () => client(over));
const clients: ImpactClient[] = [
  ...many(8, { kycApproved: true }),
  client({ kycApproved: true, funded: true, revenue: 6000, revenueByMonth: { "2027-04": 6000 } }),
  client({ kycApproved: true, funded: true, revenue: 4000, revenueByMonth: { "2027-04": 4000 }, creative: "Carousel B", contact: "late", firstContactMinutes: 90 }),
  client({ group: { key: "google:9", label: "NRI Search", kind: "campaign" }, creative: "Ad 1" }),
  client({ group: { key: "partner_code", label: "Partner codes", kind: "source" }, funded: true, revenue: 300 }),
];

const fresh = (over: Partial<SpendFreshness> = {}): SpendFreshness => ({ lastSuccessAt: d("2027-04-20T02:00:00Z"), ageLabel: "4 hours ago", stale: false, partial: false, coveredDays: 30, expectedDays: 30, messages: [], ...over });
const NOW = d("2027-04-20T06:00:00Z");
const source = (over: Partial<OutcomeSource> = {}): OutcomeSource => ({
  load: async () => ({ report: buildImpact({ clients, spend, slaMinutes: 15, currency: "INR" }), freshness: [{ channel: "meta", label: "Meta", value: fresh() }, { channel: "google", label: "Google", value: fresh() }], truncated: false }),
  now: () => NOW,
  ...over,
});
const range = { from: "2027-03-22", to: "2027-04-20" };
const admin: OutcomeCaller = { kind: "user", id: "a1", role: "ADMIN" };

describe("who may read marketing outcomes", () => {
  const provider = createOutcomeProvider(source());
  it.each(["RM", "MANAGER", "FINANCE", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "", "analyst"])("refuses the %s role before loading anything", async (role) => {
    let loaded = false;
    const p = createOutcomeProvider(source({ load: async () => { loaded = true; throw new Error("must not load"); } }));
    await expect(p.outcomes({ grain: "campaign", period: range }, { kind: "user", id: "u", role })).rejects.toBeInstanceOf(OutcomeAccessError);
    expect(loaded).toBe(false);
  });
  it.each(["ADMIN", "MARKETING"])("admits %s", async (role) => {
    await expect(provider.outcomes({ grain: "campaign", period: range }, { kind: "user", id: "u", role })).resolves.toMatchObject({ grain: "campaign" });
  });
  it("admits only the registered system consumers, and refuses any other name", async () => {
    for (const consumer of OUTCOME_CONSUMERS) await expect(provider.outcomes({ grain: "campaign", period: range }, { kind: "system", consumer })).resolves.toBeDefined();
    await expect(provider.outcomes({ grain: "campaign", period: range }, { kind: "system", consumer: "my-own-module" as never })).rejects.toBeInstanceOf(OutcomeAccessError);
  });
  it("lists exactly the modules the architecture names as readers", () => {
    expect([...OUTCOME_CONSUMERS].sort()).toEqual(["autopilot", "closed-loop", "control-plane", "creative", "director-reports", "planner"]);
  });
});

describe("what it returns: aggregates only, never a person", () => {
  it("has no customer name, id, RM or answer anywhere in the report", async () => {
    const report = await createOutcomeProvider(source()).outcomes({ grain: "campaign", period: range }, admin);
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/Customer \d|Karan|"c\d+"|clientId|rmName|rmId/);
  });
});

describe("campaign grain", () => {
  it("reports spend, leads, contacted in SLA, KYC, funded and revenue per campaign, with the one definition of each", async () => {
    const r = await createOutcomeProvider(source()).outcomes({ grain: "campaign", period: range }, admin);
    const row = r.rows.find((x) => x.key === "meta:111")!;
    expect(row).toMatchObject({ grain: "campaign", channel: "meta", spend: 10000, currency: "INR", leads: 10, kyc: 10, funded: 2, revenue: 10000, late: 1 });
    expect(row.contactedInSla).toBe(9);
    expect(row.costPerLead).toBeCloseTo(1000);
    expect(row.costPerFunded).toBeCloseTo(5000);
    expect(row.roas).toBeCloseTo(1);
    expect(r.totals).toMatchObject({ leads: 12, spend: 13000, funded: 3 });
    expect(Object.keys(OUTCOME_DEFINITIONS).sort()).toEqual(["contactedInSla", "costPerFunded", "costPerLead", "funded", "kyc", "leads", "revenue", "roas", "spend"]);
  });
  it("narrows to one channel or one campaign", async () => {
    const p = createOutcomeProvider(source());
    expect((await p.outcomes({ grain: "campaign", period: range, channel: "google" }, admin)).rows.map((x) => x.key)).toEqual(["google:9"]);
    expect((await p.outcomes({ grain: "campaign", period: range, campaignKey: "meta:111" }, admin)).rows.map((x) => x.key)).toEqual(["meta:111"]);
  });
  it("keeps partner, referral and unattributed buckets visible but labelled, with no spend and no cost figure (never invented)", async () => {
    const r = await createOutcomeProvider(source()).outcomes({ grain: "campaign", period: range }, admin);
    const partner = r.rows.find((x) => x.key === "partner_code")!;
    expect(partner).toMatchObject({ rowKind: "source", spend: null, costPerLead: null, costPerFunded: null, roas: null, leads: 1, funded: 1 });
  });
  it("passes the period through to the loader", async () => {
    let seen: unknown;
    await createOutcomeProvider(source({ load: async (period) => { seen = period; return (await source().load(period)); } })).outcomes({ grain: "campaign", period: range }, admin);
    expect(seen).toEqual(range);
  });
  it("refuses a malformed period instead of guessing", async () => {
    const p = createOutcomeProvider(source());
    await expect(p.outcomes({ grain: "campaign", period: { from: "yesterday", to: "2027-04-20" } }, admin)).rejects.toThrow(/period/i);
    await expect(p.outcomes({ grain: "campaign", period: { from: "2027-04-20", to: "2027-03-01" } }, admin)).rejects.toThrow(/period/i);
  });
});

describe("ad grain (creative) and ad set grain", () => {
  it("ad rows carry leads, funded, revenue and spend only where the platform reports per ad; contact and KYC are not computed per ad and say so (null)", async () => {
    const r = await createOutcomeProvider(source()).outcomes({ grain: "ad", period: range }, admin);
    const a = r.rows.find((x) => x.label === "Carousel A")!;
    expect(a).toMatchObject({ grain: "ad", campaignKey: "meta:111", spend: 6000, leads: 9, funded: 1, revenue: 6000, kyc: null, contactedInSla: null });
    const b = r.rows.find((x) => x.label === "Carousel B")!;
    expect(b).toMatchObject({ spend: null, costPerLead: null, funded: 1 });
  });
  it("ad set outcomes are unsupported, said plainly, and return no rows: spend is not synced at that level", async () => {
    const r = await createOutcomeProvider(source()).outcomes({ grain: "adset", period: range }, admin);
    expect(r.supported).toBe(false);
    expect(r.rows).toEqual([]);
    expect(r.unsupportedReason).toMatch(/ad set/i);
  });
});

describe("data age and confidence are always attached", () => {
  it("states when spend was last synced per channel, and how fresh the report is", async () => {
    const r = await createOutcomeProvider(source()).outcomes({ grain: "campaign", period: range }, admin);
    expect(r.dataAge.asOf).toBe(NOW.toISOString());
    expect(r.dataAge.spend).toEqual([
      expect.objectContaining({ channel: "meta", status: "fresh", lastSyncAt: "2027-04-20T02:00:00.000Z" }),
      expect.objectContaining({ channel: "google", status: "fresh" }),
    ]);
  });
  it("stale, partial and missing spend are named, never hidden, and lower the confidence", async () => {
    const stale = source({ load: async () => ({ report: buildImpact({ clients, spend, slaMinutes: 15, currency: "INR" }), freshness: [{ channel: "meta", label: "Meta", value: fresh({ stale: true, ageLabel: "3 days ago", messages: ["Spend was last updated 3 days ago"] }) }, { channel: "google", label: "Google", value: fresh({ lastSuccessAt: null, ageLabel: null, coveredDays: 0 }) }], truncated: false }) });
    const r = await createOutcomeProvider(stale).outcomes({ grain: "campaign", period: range }, admin);
    expect(r.dataAge.spend.map((s) => s.status)).toEqual(["stale", "missing"]);
    expect(r.rows.find((x) => x.key === "meta:111")!.confidence.label).not.toBe("high");
    expect(r.rows.find((x) => x.key === "meta:111")!.confidence.reasons.join(" ")).toMatch(/3 days ago|stale|not been updated/i);
  });
  it("a truncated lead window is said so", async () => {
    const r = await createOutcomeProvider(source({ load: async () => ({ ...(await source().load(range)), truncated: true }) })).outcomes({ grain: "campaign", period: range }, admin);
    expect(r.truncated).toBe(true);
    expect(r.notes.join(" ")).toMatch(/first 5000|window|truncated/i);
  });
});

describe("labelConfidence (defaults, labelled as configurable)", () => {
  const ok = { leads: 40, high: 36, medium: 3, low: 1, spendKnown: true, spendStale: false, spendPartial: false };
  it("high when there is enough data, mostly high-confidence attribution and fresh spend", () => expect(labelConfidence(ok).label).toBe("high"));
  it("insufficient below the minimum number of leads, whatever else is true", () => {
    expect(labelConfidence({ ...ok, leads: CONFIDENCE_DEFAULTS.minLeads - 1 }).label).toBe("insufficient");
    expect(labelConfidence({ ...ok, leads: CONFIDENCE_DEFAULTS.minLeads }).label).not.toBe("insufficient");
  });
  it("medium when spend is stale or partial", () => {
    expect(labelConfidence({ ...ok, spendStale: true }).label).toBe("medium");
    expect(labelConfidence({ ...ok, spendPartial: true }).label).toBe("medium");
  });
  it("low when the campaign has no spend figure at all, or most attribution is low confidence", () => {
    expect(labelConfidence({ ...ok, spendKnown: false }).label).toBe("low");
    expect(labelConfidence({ ...ok, high: 5, medium: 5, low: 30 }).label).toBe("low");
  });
  it("always says why", () => expect(labelConfidence({ ...ok, spendStale: true, high: 10, medium: 20, low: 10 }).reasons.length).toBeGreaterThan(0));
});
