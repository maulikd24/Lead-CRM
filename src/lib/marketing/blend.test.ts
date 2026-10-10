import { describe, expect, it } from "vitest";
import { blendReports } from "./blend";
import { buildReport, type AdDayRow, type OutcomeLead } from "./metrics";

const base = { from: "2026-10-01", to: "2026-10-03" };
const ad = (over: Partial<AdDayRow>): AdDayRow => ({ campaignId: "1", campaignName: "Alpha", date: "2026-10-01", spendMinor: 100000, currency: "INR", impressions: 1000, clicks: 50, reach: 0, leads: 5, ...over });
let n = 0;
const lead = (attribution: Record<string, unknown>, leadSource: string, over: Partial<OutcomeLead> = {}): OutcomeLead => {
  n++;
  return { clientId: `c${n}`, day: "2026-10-01", leadSource, attribution, kycApproved: false, funded: false, firstTransaction: false, aum: 0, revenue: 0, ...over };
};

const meta = buildReport({
  ...base,
  channel: "meta",
  ads: [ad({ spendMinor: 200000 })],
  identities: [{ campaignId: "1", campaignName: "Alpha" }],
  leads: [lead({ source: "meta_leads", campaign_id: "1" }, "Meta Ads", { funded: true, kycApproved: true, revenue: 600, aum: 10000 }), lead({ source: "meta_leads", campaign_id: "1" }, "Meta Ads")],
});
const google = buildReport({
  ...base,
  channel: "google",
  ads: [ad({ campaignId: "9", campaignName: "Search", spendMinor: 100000, date: "2026-10-02" })],
  identities: [{ campaignId: "9", campaignName: "Search" }],
  leads: [lead({ source: "google_ads", campaign: "9" }, "Google Ads", { funded: true, kycApproved: true, revenue: 300, aum: 5000 }), lead({ gclid: "z", campaign: "9" }, "Google Ads"), lead({ gclid: "z2", campaign: "9" }, "Google Ads")],
});

describe("buildReport channel", () => {
  it("only counts the leads of its own channel", () => {
    expect(meta.totals.crmLeads).toBe(2);
    expect(google.totals.crmLeads).toBe(3);
    expect(meta.excluded.nonMeta).toBe(0);
  });
});

describe("blendReports", () => {
  const blended = blendReports({ meta, google });

  it("adds spend, leads and revenue across channels and derives CPL and ROAS from the sums", () => {
    expect(blended.currency).toBe("INR");
    expect(blended.totals).toMatchObject({ spend: 3000, crmLeads: 5, funded: 2, revenue: 900, aum: 15000 });
    expect(blended.totals.cpl).toBe(600);
    expect(blended.totals.roas).toBeCloseTo(0.3, 5);
    expect(blended.totals.costPerFunded).toBe(1500);
  });

  it("keeps a row per channel with its own CPL, ROAS and share of spend", () => {
    const m = blended.channels.find((c) => c.channel === "meta")!;
    const g = blended.channels.find((c) => c.channel === "google")!;
    expect(m).toMatchObject({ label: "Meta", spend: 2000, crmLeads: 2, cpl: 1000, revenue: 600 });
    expect(m.roas).toBeCloseTo(0.3, 5);
    expect(g).toMatchObject({ spend: 1000, crmLeads: 3 });
    expect(g.cpl).toBeCloseTo(333.33, 1);
    expect(m.spendShare).toBeCloseTo(2 / 3, 5);
    expect(m.spendShare + g.spendShare).toBeCloseTo(1, 5);
  });

  it("sums the daily series by date with spend split by channel", () => {
    const d1 = blended.daily.find((d) => d.date === "2026-10-01")!;
    const d2 = blended.daily.find((d) => d.date === "2026-10-02")!;
    expect(d1.byChannel).toEqual({ meta: 2000, google: 0 });
    expect(d2.byChannel).toEqual({ meta: 0, google: 1000 });
    expect(d1.spend).toBe(2000);
    expect(d1.crmLeads).toBe(5);
    expect(blended.daily.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("lists every campaign with its channel, biggest spend first", () => {
    expect(blended.campaigns.map((c) => [c.channel, c.campaignId])).toEqual([["meta", "1"], ["google", "9"]]);
  });

  it("works with one channel, and with none", () => {
    expect(blendReports({ meta }).channels).toHaveLength(1);
    const empty = blendReports({});
    expect(empty.totals.spend).toBe(0);
    expect(empty.totals.cpl).toBeNull();
    expect(empty.channels).toEqual([]);
  });

  it("leaves out a channel billed in another currency and says so; ROAS is blank outside INR", () => {
    const usd = buildReport({ ...base, channel: "google", ads: [ad({ campaignId: "9", currency: "USD", spendMinor: 5000 })], identities: [{ campaignId: "9", campaignName: "Search" }], leads: [] });
    const mixed = blendReports({ meta, google: usd });
    expect(mixed.currency).toBe("INR");
    expect(mixed.channels.map((c) => c.channel)).toEqual(["meta"]);
    expect(mixed.notes.some((x) => /USD/.test(x.text))).toBe(true);
    const only = blendReports({ google: usd });
    expect(only.currency).toBe("USD");
    expect(only.totals.roas).toBeNull();
  });
});
