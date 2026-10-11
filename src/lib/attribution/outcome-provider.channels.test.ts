import { describe, expect, it } from "vitest";

import { buildImpact, type ImpactClient, type SpendFreshness, type SpendInput } from "./impact";
import { createOutcomeProvider, type OutcomeCaller, type OutcomeSource } from "./outcome-provider";

/**
 * By-channel totals: the director reports read ONE set of channel numbers from the provider (Meta, Google, partner codes, referral codes)
 * instead of attributing customers a second way. Cost per funded customer and return are computed here and only here.
 */
const d = (iso: string) => new Date(iso);
let n = 0;
const client = (over: Partial<ImpactClient> = {}): ImpactClient => ({
  clientId: `c${++n}`, name: `Customer ${n}`, rmId: null, rmName: null, stage: "New Lead", createdAt: d("2027-03-10T05:00:00Z"), leadMonth: "2027-03",
  group: { key: "meta:111", label: "Retirement Planning", kind: "campaign" }, creative: "Carousel A", confidence: "high",
  contact: "in_sla", firstContactMinutes: 8, kycApproved: false, funded: false, revenue: 0, revenueByMonth: {}, ...over,
});
const many = (k: number, over: Partial<ImpactClient> = {}) => Array.from({ length: k }, () => client(over));
const spend: SpendInput[] = [
  { key: "meta:111", label: "Retirement Planning", channel: "meta", spend: 10000, currency: "INR", creatives: [] },
  { key: "meta:222", label: "Demat Basics", channel: "meta", spend: 2000, currency: "INR", creatives: [] },
  { key: "google:9", label: "NRI Search", channel: "google", spend: 3000, currency: "INR", creatives: [] },
];
const clients: ImpactClient[] = [
  ...many(6, { kycApproved: true }),
  client({ kycApproved: true, funded: true, revenue: 6000 }),
  client({ kycApproved: true, funded: true, revenue: 4000 }),
  client({ group: { key: "meta:222", label: "Demat Basics", kind: "campaign" }, funded: true, revenue: 500 }),
  client({ group: { key: "meta:unknown", label: "Meta ads, campaign not identified", kind: "source" }, funded: true, revenue: 700 }),
  client({ group: { key: "google:9", label: "NRI Search", kind: "campaign" } }),
  client({ group: { key: "partner_code", label: "Partner codes", kind: "source" }, funded: true, revenue: 300, kycApproved: true }),
  client({ group: { key: "referral_code", label: "Referral codes", kind: "source" }, kycApproved: true }),
  client({ group: { key: "form", label: "Website forms", kind: "source" }, funded: true, revenue: 50 }),
  client({ group: { key: "unattributed", label: "Unattributed", kind: "unattributed" } }),
];
const fresh = (over: Partial<SpendFreshness> = {}): SpendFreshness => ({ lastSuccessAt: d("2027-04-20T02:00:00Z"), ageLabel: "4 hours ago", stale: false, partial: false, coveredDays: 30, expectedDays: 30, messages: [], ...over });
const source = (over: Partial<OutcomeSource> = {}): OutcomeSource => ({
  load: async () => ({ report: buildImpact({ clients, spend, slaMinutes: 15, currency: "INR" }), freshness: [{ channel: "meta", label: "Meta", value: fresh() }, { channel: "google", label: "Google", value: fresh() }], truncated: false }),
  now: () => d("2027-04-20T06:00:00Z"),
  ...over,
});
const range = { from: "2027-03-22", to: "2027-04-20" };
const caller: OutcomeCaller = { kind: "system", consumer: "director-reports" };
const channel = (r: Awaited<ReturnType<ReturnType<typeof createOutcomeProvider>["outcomes"]>>, key: string) => r.byChannel.find((c) => c.channel === key)!;

describe("by-channel totals", () => {
  it("lists Meta, Google, partner and referral, in that order, on every report", async () => {
    const r = await createOutcomeProvider(source()).outcomes({ grain: "campaign", period: range }, caller);
    expect(r.byChannel.map((c) => c.channel)).toEqual(["meta", "google", "partner", "referral"]);
  });
  it("Meta sums its campaigns and its unidentified-campaign bucket; spend only from campaigns", async () => {
    const m = channel(await createOutcomeProvider(source()).outcomes({ grain: "campaign", period: range }, caller), "meta");
    expect(m).toMatchObject({ available: true, spend: 12000, leads: 10, kyc: 8, funded: 4, revenue: 11200 });
  });
  it("cost per funded customer and return use only the campaigns that have spend (the unidentified bucket never dilutes them)", async () => {
    const m = channel(await createOutcomeProvider(source()).outcomes({ grain: "campaign", period: range }, caller), "meta");
    expect(m.costPerFunded).toBeCloseTo(12000 / 3, 5);
    expect(m.roas).toBeCloseTo(10500 / 12000, 5);
  });
  it("a channel with spend and nothing funded has no cost per funded customer rather than a zero or infinity", async () => {
    const g = channel(await createOutcomeProvider(source()).outcomes({ grain: "campaign", period: range }, caller), "google");
    expect(g).toMatchObject({ spend: 3000, leads: 1, funded: 0, costPerFunded: null, roas: null });
  });
  it("partner and referral buckets carry no spend, cost or return", async () => {
    const r = await createOutcomeProvider(source()).outcomes({ grain: "campaign", period: range }, caller);
    expect(channel(r, "partner")).toMatchObject({ available: true, spend: null, leads: 1, kyc: 1, funded: 1, revenue: 300, costPerFunded: null, roas: null });
    expect(channel(r, "referral")).toMatchObject({ available: true, spend: null, leads: 1, funded: 0, costPerFunded: null, roas: null });
  });
  it("website forms and unattributed customers belong to no channel", async () => {
    const r = await createOutcomeProvider(source()).outcomes({ grain: "campaign", period: range }, caller);
    const leads = r.byChannel.reduce((a, c) => a + (c.leads ?? 0), 0);
    expect(leads).toBe(10 + 1 + 1 + 1);
  });
  it("a channel with no rows and no sync is reported as not available, never as zero", async () => {
    const empty = createOutcomeProvider(source({ load: async () => ({ report: buildImpact({ clients: [], spend: [], slaMinutes: 15, currency: "INR" }), freshness: [{ channel: "meta", label: "Meta", value: fresh({ lastSuccessAt: null, coveredDays: 0, ageLabel: null }) }, { channel: "google", label: "Google", value: fresh({ lastSuccessAt: null, coveredDays: 0, ageLabel: null }) }], truncated: false }) }));
    const r = await empty.outcomes({ grain: "campaign", period: range }, caller);
    for (const c of r.byChannel) expect(c, c.channel).toMatchObject({ available: false, spend: null, leads: null, funded: null, revenue: null, costPerFunded: null, roas: null });
  });
  it("return is shown only when the report currency is INR (revenue is in rupees)", async () => {
    const usd = createOutcomeProvider(source({ load: async () => ({ report: buildImpact({ clients, spend: spend.map((s) => ({ ...s, currency: "USD" })), slaMinutes: 15, currency: "USD" }), freshness: [{ channel: "meta", label: "Meta", value: fresh() }, { channel: "google", label: "Google", value: fresh() }], truncated: false }) }));
    const m = channel(await usd.outcomes({ grain: "campaign", period: range }, caller), "meta");
    expect(m.roas).toBeNull();
    expect(m.costPerFunded).not.toBeNull();
  });
  it("the totals of the channels agree with the campaign rows the same report carries", async () => {
    const r = await createOutcomeProvider(source()).outcomes({ grain: "campaign", period: range }, caller);
    const fundedFromRows = r.rows.filter((x) => x.channel === "meta" || x.key === "partner_code" || x.key === "referral_code" || x.channel === "google").reduce((a, x) => a + x.funded, 0);
    expect(r.byChannel.reduce((a, c) => a + (c.funded ?? 0), 0)).toBe(fundedFromRows);
  });
  it("is empty of people: no name, id or RM", async () => {
    const text = JSON.stringify((await createOutcomeProvider(source()).outcomes({ grain: "campaign", period: range }, caller)).byChannel);
    expect(text).not.toMatch(/Customer \d|"c\d+"|clientId|rmName/);
  });
});

describe("paid channels together", () => {
  it("Meta and Google combined, with cost per funded customer and return on the campaigns that have spend", async () => {
    const r = await createOutcomeProvider(source()).outcomes({ grain: "campaign", period: range }, caller);
    expect(r.paid).toMatchObject({ available: true, spend: 15000, leads: 11, kyc: 8, funded: 4, revenue: 11200 });
    expect(r.paid.costPerFunded).toBeCloseTo(15000 / 3, 5);
    expect(r.paid.roas).toBeCloseTo(10500 / 15000, 5);
  });
  it("is not available when neither ad channel is", async () => {
    const empty = createOutcomeProvider(source({ load: async () => ({ report: buildImpact({ clients: [], spend: [], slaMinutes: 15, currency: "INR" }), freshness: [], truncated: false }) }));
    expect((await empty.outcomes({ grain: "campaign", period: range }, caller)).paid).toMatchObject({ available: false, spend: null, funded: null, costPerFunded: null, roas: null });
  });
});

