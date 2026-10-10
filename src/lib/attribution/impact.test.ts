import { describe, expect, it } from "vitest";

import { buildImpact, classifyContact, compareImpact, spendFreshness, type ImpactClient, type SpendInput } from "./impact";

const d = (iso: string) => new Date(iso);
const NOW = d("2027-04-20T06:00:00Z");

describe("classifyContact", () => {
  const created = d("2027-04-01T05:00:00Z");
  it("in SLA, late, still inside the window, or missed", () => {
    expect(classifyContact({ createdAt: created, contactedAt: d("2027-04-01T05:10:00Z"), slaMinutes: 15, now: NOW })).toBe("in_sla");
    expect(classifyContact({ createdAt: created, contactedAt: d("2027-04-01T05:15:00Z"), slaMinutes: 15, now: NOW })).toBe("in_sla");
    expect(classifyContact({ createdAt: created, contactedAt: d("2027-04-01T06:00:00Z"), slaMinutes: 15, now: NOW })).toBe("late");
    expect(classifyContact({ createdAt: d("2027-04-20T05:55:00Z"), contactedAt: null, slaMinutes: 15, now: NOW })).toBe("pending");
    expect(classifyContact({ createdAt: created, contactedAt: null, slaMinutes: 15, now: NOW })).toBe("missed");
  });
});

let n = 0;
const client = (over: Partial<ImpactClient> = {}): ImpactClient => ({
  clientId: `c${++n}`, name: `Customer ${n}`, rmId: "rm1", rmName: "Karan Mehta", stage: "New Lead", createdAt: d("2027-03-10T05:00:00Z"), leadMonth: "2027-03",
  group: { key: "meta:111", label: "Retirement Planning", kind: "campaign" }, creative: "Carousel A", confidence: "high",
  contact: "in_sla", firstContactMinutes: 8, kycApproved: false, funded: false, revenue: 0, revenueByMonth: {}, ...over,
});

const spend: SpendInput[] = [
  { key: "meta:111", label: "Retirement Planning", channel: "meta", spend: 10000, currency: "INR", creatives: [{ name: "Carousel A", spend: 6000 }] },
  { key: "meta:222", label: "ELSS Tax Saving", channel: "meta", spend: 5000, currency: "INR", creatives: [] },
];

describe("buildImpact", () => {
  const clients: ImpactClient[] = [
    client({ kycApproved: true, funded: true, revenue: 6000, revenueByMonth: { "2027-04": 4000, "2027-05": 2000 } }),
    client({ kycApproved: true, funded: false, contact: "late", firstContactMinutes: 95 }),
    client({ leadMonth: "2027-04", createdAt: d("2027-04-05T05:00:00Z"), contact: "missed", firstContactMinutes: null, creative: "Carousel B" }),
    client({ group: { key: "meta:222", label: "ELSS Tax Saving", kind: "campaign" }, funded: true, kycApproved: true, revenue: 1000, revenueByMonth: { "2027-04": 1000 }, creative: null }),
    client({ group: { key: "partner_code", label: "Partner codes", kind: "source" }, confidence: "high", funded: true, revenue: 300, revenueByMonth: { "2027-04": 300 } }),
    client({ group: { key: "unattributed", label: "Unattributed", kind: "unattributed" }, confidence: null, contact: "pending", firstContactMinutes: null }),
  ];
  const report = buildImpact({ clients, spend, slaMinutes: 15, currency: "INR" });
  const row = (key: string) => report.rows.find((r) => r.key === key)!;

  it("counts leads, KYC, funded and revenue per campaign", () => {
    expect(row("meta:111")).toMatchObject({ leads: 3, kyc: 2, funded: 1, revenue: 6000, spend: 10000 });
    expect(row("meta:222")).toMatchObject({ leads: 1, kyc: 1, funded: 1, revenue: 1000, spend: 5000 });
  });

  it("counts the leads reached late and the ones never reached", () => {
    expect(row("meta:111")).toMatchObject({ late: 1, missed: 1, contactedInSla: 1 });
    expect(row("unattributed")).toMatchObject({ late: 0, missed: 0 });
    expect(report.totals).toMatchObject({ missed: 1, late: 1 });
  });

  it("cost per lead, cost per funded customer and ROAS come from summed spend, leads and revenue", () => {
    expect(row("meta:111").cpl).toBeCloseTo(10000 / 3);
    expect(row("meta:111").costPerFunded).toBe(10000);
    expect(row("meta:111").roas).toBeCloseTo(0.6);
    expect(row("meta:222").roas).toBeCloseTo(0.2);
  });

  it("contacted-in-SLA rate leaves out leads still inside their window", () => {
    expect(row("meta:111").contactedInSlaRate).toBeCloseTo(1 / 3);
    expect(row("unattributed").contactedInSlaRate).toBeNull();
  });

  it("payback: months to recover spend, or the share recovered so far", () => {
    const r = buildImpact({ clients: [client({ funded: true, revenue: 12000, revenueByMonth: { "2027-04": 5000, "2027-05": 7000 } })], spend: [{ key: "meta:111", label: "RP", channel: "meta", spend: 10000, currency: "INR", creatives: [] }], slaMinutes: 15, currency: "INR" });
    expect(r.rows[0].paybackMonths).toBe(2);
    expect(row("meta:111").paybackMonths).toBeNull();
    expect(row("meta:111").recoveredPct).toBeCloseTo(0.6);
  });

  it("non-campaign buckets carry no spend and so no cost or return: never invented", () => {
    for (const key of ["partner_code", "unattributed"]) expect(row(key)).toMatchObject({ spend: null, cpl: null, costPerFunded: null, roas: null, paybackMonths: null, recoveredPct: null });
    expect(row("partner_code")).toMatchObject({ leads: 1, funded: 1, revenue: 300 });
  });

  it("a campaign with spend but no leads still has a row, and its cost per lead is not a number", () => {
    const r = buildImpact({ clients: [], spend, slaMinutes: 15, currency: "INR" });
    expect(r.rows.map((x) => x.key).sort()).toEqual(["meta:111", "meta:222"]);
    expect(r.rows[0]).toMatchObject({ leads: 0, cpl: null, roas: null });
  });

  it("a campaign whose spend is unknown (not in the spend data) has no spend figure", () => {
    const r = buildImpact({ clients: [client({ group: { key: "meta:999", label: "Diwali PMS", kind: "campaign" } })], spend: [], slaMinutes: 15, currency: "INR" });
    expect(r.rows[0]).toMatchObject({ key: "meta:999", spend: null, cpl: null, spendKnown: false });
  });

  it("creatives: leads, funded and revenue from the CRM, spend only where the platform reports per ad", () => {
    const cr = row("meta:111").creatives;
    expect(cr.find((c) => c.name === "Carousel A")).toMatchObject({ leads: 2, funded: 1, revenue: 6000, spend: 6000 });
    expect(cr.find((c) => c.name === "Carousel B")).toMatchObject({ leads: 1, spend: null, cpl: null });
  });

  it("cohorts by lead month", () => {
    expect(row("meta:111").cohorts).toEqual([
      { month: "2027-03", leads: 2, funded: 1, revenue: 6000 },
      { month: "2027-04", leads: 1, funded: 0, revenue: 0 },
    ]);
  });

  it("totals add up; the unattributed share is explicit", () => {
    expect(report.totals).toMatchObject({ leads: 6, funded: 3, kyc: 3, revenue: 7300, spend: 15000 });
    // Cost per lead and return use only the leads and revenue of campaigns that have spend: a partner or organic lead cost nothing we know of.
    expect(report.totals.cpl).toBeCloseTo(3750);
    expect(report.totals.roas).toBeCloseTo(7000 / 15000);
    expect(report.unattributedShare).toBeCloseTo(1 / 6);
  });

  it("another currency is left out of cost and return, and said so", () => {
    const r = buildImpact({ clients, spend: [{ ...spend[0], currency: "USD" }], slaMinutes: 15, currency: "INR" });
    expect(r.rows.find((x) => x.key === "meta:111")).toMatchObject({ spend: null });
    expect(r.notes.join(" ")).toMatch(/USD/);
  });

  it("rows are ordered by spend, then leads", () => {
    expect(report.rows.map((r) => r.key).slice(0, 2)).toEqual(["meta:111", "meta:222"]);
  });
});

describe("compareImpact", () => {
  it("shows the change in leads, cost per lead, funded and revenue against the previous period", () => {
    const cur = buildImpact({ clients: [client({ funded: true, revenue: 1000 }), client()], spend: [{ key: "meta:111", label: "RP", channel: "meta", spend: 4000, currency: "INR", creatives: [] }], slaMinutes: 15, currency: "INR" });
    const prev = buildImpact({ clients: [client({ funded: true, revenue: 500 })], spend: [{ key: "meta:111", label: "RP", channel: "meta", spend: 3000, currency: "INR", creatives: [] }], slaMinutes: 15, currency: "INR" });
    const c = compareImpact(cur, prev);
    expect(c.totals.leads).toEqual({ value: 2, prev: 1, change: 1 });
    expect(c.totals.revenue).toEqual({ value: 1000, prev: 500, change: 1 });
    expect(c.totals.cpl.prev).toBe(3000);
    expect(c.rows["meta:111"].leads).toEqual({ value: 2, prev: 1, change: 1 });
  });
  it("no change figure when the previous value is zero or unknown", () => {
    const cur = buildImpact({ clients: [client()], spend: [], slaMinutes: 15, currency: "INR" });
    const prev = buildImpact({ clients: [], spend: [], slaMinutes: 15, currency: "INR" });
    const c = compareImpact(cur, prev);
    expect(c.totals.leads).toEqual({ value: 1, prev: 0, change: null });
  });
});

describe("spendFreshness: how old and how complete the spend data is", () => {
  const range = { from: "2027-04-01", to: "2027-04-20" };
  it("fresh and complete", () => {
    const days = new Set(Array.from({ length: 20 }, (_, i) => `2027-04-${String(i + 1).padStart(2, "0")}`));
    const f = spendFreshness({ now: NOW, today: "2027-04-20", range, lastSuccessAt: d("2027-04-20T02:00:00Z"), daysWithData: days, historyStart: "2027-01-01" });
    expect(f).toMatchObject({ stale: false, partial: false, coveredDays: 20, expectedDays: 20, ageLabel: "4 hours ago" });
  });
  it("stale after 36 hours and says how old", () => {
    const f = spendFreshness({ now: NOW, today: "2027-04-20", range, lastSuccessAt: d("2027-04-17T06:00:00Z"), daysWithData: new Set(["2027-04-01"]), historyStart: "2027-01-01" });
    expect(f.stale).toBe(true);
    expect(f.ageLabel).toBe("3 days ago");
    expect(f.messages.join(" ")).toMatch(/3 days ago/);
  });
  it("partial when days are missing, and when history starts inside the range the earlier days are not expected", () => {
    const f = spendFreshness({ now: NOW, today: "2027-04-20", range, lastSuccessAt: d("2027-04-20T05:00:00Z"), daysWithData: new Set(["2027-04-15", "2027-04-16", "2027-04-17"]), historyStart: "2027-04-10" });
    expect(f).toMatchObject({ partial: true, coveredDays: 3, expectedDays: 11 });
    expect(f.messages.join(" ")).toMatch(/3 of 11/);
  });
  it("never synced: no age, flagged, and says so", () => {
    const f = spendFreshness({ now: NOW, today: "2027-04-20", range, lastSuccessAt: null, daysWithData: new Set(), historyStart: null });
    expect(f).toMatchObject({ stale: true, ageLabel: null, coveredDays: 0 });
    expect(f.messages.join(" ")).toMatch(/no spend data/i);
  });
});
