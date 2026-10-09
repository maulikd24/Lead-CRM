import { describe, expect, it } from "vitest";
import { buildReport, classifyCampaign, MIN_LEADS_FOR_VERDICT, type AdDayRow, type OutcomeLead } from "./metrics";

function ad(over: Partial<AdDayRow>): AdDayRow {
  return { campaignId: "1", campaignName: "Alpha", date: "2026-10-01", spendMinor: 100000, currency: "INR", impressions: 1000, clicks: 50, reach: 900, leads: 5, ...over };
}
let n = 0;
function lead(over: Partial<OutcomeLead> & { campaign?: string }): OutcomeLead {
  n++;
  const { campaign, ...rest } = over;
  return { clientId: `c${n}`, day: "2026-10-01", leadSource: "Meta Ads", attribution: { source: "meta_leads", campaign_id: campaign ?? "1" }, kycApproved: false, funded: false, firstTransaction: false, aum: 0, revenue: 0, ...rest };
}
const base = { from: "2026-10-01", to: "2026-10-03" };

describe("buildReport totals and per-campaign formulas", () => {
  it("computes spend, CPL, KYC rate, cost per funded, AUM per rupee and ROAS from the formulas", () => {
    const ads = [ad({ date: "2026-10-01", spendMinor: 100000 }), ad({ date: "2026-10-02", spendMinor: 50000, leads: 4 })]; // Rs 1,000 + Rs 500
    const leads = [
      lead({ kycApproved: true, funded: true, firstTransaction: true, aum: 30000, revenue: 150 }),
      lead({ kycApproved: true, funded: true, aum: 20000, revenue: 50 }),
      lead({ kycApproved: true }),
      lead({}),
    ];
    const r = buildReport({ ...base, ads, identities: [{ campaignId: "1", campaignName: "Alpha" }], leads });
    expect(r.currency).toBe("INR");
    expect(r.totals).toMatchObject({ spend: 1500, impressions: 2000, clicks: 100, metaLeads: 9, crmLeads: 4, kyc: 3, funded: 2, firstTransaction: 1, aum: 50000, revenue: 200 });
    expect(r.totals.cpl).toBe(375); // spend / CRM leads
    expect(r.totals.cplMeta).toBeCloseTo(166.67, 1);
    expect(r.totals.costPerKyc).toBe(500);
    expect(r.totals.costPerFunded).toBe(750);
    expect(r.totals.kycRate).toBe(0.75);
    expect(r.totals.aumPerRupee).toBeCloseTo(33.33, 1);
    expect(r.totals.roas).toBeCloseTo(0.1333, 3);
    const c = r.campaigns[0];
    expect(c).toMatchObject({ campaignId: "1", name: "Alpha", spend: 1500, crmLeads: 4, funded: 2, costPerFunded: 750 });
    expect(c.spark).toEqual([1000, 500, 0]);
  });

  it("gives null, never Infinity or NaN, when a denominator is zero", () => {
    const r = buildReport({ ...base, ads: [ad({ leads: 0 })], identities: [{ campaignId: "1", campaignName: "Alpha" }], leads: [] });
    expect(r.totals.cpl).toBeNull();
    expect(r.totals.costPerKyc).toBeNull();
    expect(r.totals.costPerFunded).toBeNull();
    expect(r.totals.kycRate).toBeNull();
    expect(r.totals.roas).toBeNull();
    const none = buildReport({ ...base, ads: [], identities: [], leads: [] });
    expect(none.totals.spend).toBe(0);
    expect(none.campaigns).toEqual([]);
  });

  it("only counts ad rows and leads inside the date range (the lead-in rows are for tie-breaks only)", () => {
    const ads = [ad({ date: "2026-09-29", spendMinor: 999999 }), ad({ date: "2026-10-02" }), ad({ date: "2026-10-09", spendMinor: 999999 })];
    const leads = [lead({ day: "2026-09-30" }), lead({ day: "2026-10-02" })];
    const r = buildReport({ ...base, ads, identities: [{ campaignId: "1", campaignName: "Alpha" }], leads });
    expect(r.totals.spend).toBe(1000);
    expect(r.totals.crmLeads).toBe(1);
  });

  it("sums only the dominant currency and reports the rest as excluded; ratios against INR AUM need INR", () => {
    const ads = [ad({ spendMinor: 100000 }), ad({ campaignId: "2", currency: "USD", spendMinor: 5000 })];
    const r = buildReport({ ...base, ads, identities: [{ campaignId: "1", campaignName: "Alpha" }], leads: [lead({ funded: true, aum: 100 })] });
    expect(r.currency).toBe("INR");
    expect(r.excluded.otherCurrencyRows).toBe(1);
    const usd = buildReport({ ...base, ads: [ad({ currency: "USD" })], identities: [{ campaignId: "1", campaignName: "Alpha" }], leads: [lead({ funded: true, aum: 100 })] });
    expect(usd.totals.aumPerRupee).toBeNull();
    expect(usd.totals.roas).toBeNull();
    expect(usd.notes.join(" ")).toMatch(/INR/);
  });
});

describe("buildReport attribution and the unattributed bucket", () => {
  it("separates unattributed Meta leads with reasons, and keeps them in the funnel totals", () => {
    const leads = [lead({ funded: true, kycApproved: true, aum: 10 }), lead({ campaign: "zzz", kycApproved: true }), lead({ attribution: { source: "meta_leads" } })];
    const r = buildReport({ ...base, ads: [ad({})], identities: [{ campaignId: "1", campaignName: "Alpha" }], leads });
    expect(r.campaigns[0].crmLeads).toBe(1);
    expect(r.unattributed).toMatchObject({ leads: 2, kyc: 1, funded: 0, reasons: { no_match: 1, no_campaign_info: 1, ambiguous_campaign_name: 0 } });
    expect(r.totals.crmLeads).toBe(3);
    expect(r.funnel.map((f) => f.key)).toEqual(["impressions", "clicks", "leads", "kyc", "funded"]);
    expect(r.funnel.find((f) => f.key === "leads")?.value).toBe(3);
  });

  it("reports excluded non-Meta leads and duplicates", () => {
    const dup = lead({});
    const r = buildReport({ ...base, ads: [ad({})], identities: [{ campaignId: "1", campaignName: "Alpha" }], leads: [dup, { ...dup }, lead({ leadSource: "Google Ads", attribution: { gclid: "g" } })] });
    expect(r.excluded).toMatchObject({ nonMeta: 1, duplicates: 1 });
  });

  it("still lists a campaign that has CRM leads but no spend in range, so its leads are not lost", () => {
    const r = buildReport({ ...base, ads: [ad({})], identities: [{ campaignId: "1", campaignName: "Alpha" }, { campaignId: "7", campaignName: "Old" }], leads: [lead({ campaign: "7" })] });
    const old = r.campaigns.find((c) => c.campaignId === "7");
    expect(old).toMatchObject({ spend: 0, crmLeads: 1 });
  });
});

describe("daily series", () => {
  it("returns one point per day in the range with spend, Meta leads, CRM leads and funded", () => {
    const r = buildReport({ ...base, ads: [ad({ date: "2026-10-02", spendMinor: 20000, leads: 3 })], identities: [{ campaignId: "1", campaignName: "Alpha" }], leads: [lead({ day: "2026-10-02", funded: true }), lead({ day: "2026-10-03" })] });
    expect(r.daily.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(r.daily[1]).toMatchObject({ spend: 200, metaLeads: 3, crmLeads: 1, funded: 1, cpl: 200 });
    expect(r.daily[0]).toMatchObject({ spend: 0, crmLeads: 0, cpl: null });
    expect(r.daily[2].crmLeads).toBe(1);
  });
});

describe("classifyCampaign quality flag", () => {
  const bench = { cpl: 400, costPerFunded: 4000 };
  const row = (o: Partial<Parameters<typeof classifyCampaign>[0]>) => ({ spend: 5000, impressions: 5000, metaLeads: 12, crmLeads: MIN_LEADS_FOR_VERDICT, funded: 0, cpl: 300, costPerFunded: null as number | null, ...o });

  it("flags spend with no leads", () => {
    expect(classifyCampaign(row({ metaLeads: 0, crmLeads: 0, cpl: null }), bench).key).toBe("no_leads");
  });
  it("is honest when there are too few leads to judge", () => {
    expect(classifyCampaign(row({ crmLeads: MIN_LEADS_FOR_VERDICT - 1 }), bench).key).toBe("early");
  });
  it("calls out cheap leads that never fund, in plain words", () => {
    const q = classifyCampaign(row({ funded: 0, cpl: 300 }), bench);
    expect(q.key).toBe("cheap_no_funded");
    expect(q.tone).toBe("warning");
    expect(q.label).toMatch(/cheap leads/i);
  });
  it("flags non-funding leads that are also expensive", () => {
    expect(classifyCampaign(row({ funded: 0, cpl: 900 }), bench).key).toBe("no_funded");
  });
  it("grades funded campaigns against the account-wide cost per funded customer", () => {
    expect(classifyCampaign(row({ funded: 3, costPerFunded: 2000 }), bench).key).toBe("efficient");
    expect(classifyCampaign(row({ funded: 3, costPerFunded: 4100 }), bench).key).toBe("on_par");
    expect(classifyCampaign(row({ funded: 3, costPerFunded: 7000 }), bench).key).toBe("expensive");
  });
  it("shows no spend as inactive", () => {
    expect(classifyCampaign(row({ spend: 0, metaLeads: 0, crmLeads: 0, cpl: null }), bench).key).toBe("inactive");
  });
});
