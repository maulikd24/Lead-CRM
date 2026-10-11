import { describe, expect, it } from "vitest";

import { buildDirectorReport, type PeriodData, type ChannelPeriod } from "./report";

const ch = (channel: ChannelPeriod["channel"], over: Partial<ChannelPeriod> = {}): ChannelPeriod => ({ channel, available: true, spend: null, leads: 10, kyc: 5, funded: 3, revenue: 3000, costPerFunded: null, roas: null, ...over });
const off = (channel: ChannelPeriod["channel"]): ChannelPeriod => ({ channel, available: false, spend: null, leads: null, kyc: null, funded: null, revenue: null, costPerFunded: null, roas: null });
const period = (from: string, to: string, channels: ChannelPeriod[], over: Partial<PeriodData> = {}): PeriodData => ({
  from, to, currency: "INR", channels, campaigns: [], asOf: { meta: "2026-10-05T06:00:00Z", google: "2026-10-05T06:00:00Z", referral: null, partner: null }, notes: [], paid: { costPerFunded: null, roas: null }, ...over,
});
const NOW = "2026-10-06T06:00:00Z";
const cur = period("2026-09-29", "2026-10-05", [ch("meta", { spend: 50_000, leads: 100, kyc: 40, funded: 18, revenue: 90_000, costPerFunded: 2_778, roas: 1.8 }), ch("google", { spend: 30_000, leads: 40, kyc: 10, funded: 0, revenue: 0 }), ch("referral", { funded: 4, revenue: 8_000 }), ch("partner", { funded: 2, revenue: 5_000 })], { paid: { costPerFunded: 4_444, roas: 1.125 } });
const prev = period("2026-09-22", "2026-09-28", [ch("meta", { spend: 40_000, leads: 90, kyc: 30, funded: 12, revenue: 60_000, costPerFunded: 3_333, roas: 1.5 }), ch("google", { spend: 25_000, leads: 35, kyc: 8, funded: 2, revenue: 3_000 }), ch("referral", { funded: 3, revenue: 6_000 }), ch("partner", { funded: 2, revenue: 5_000 })], { paid: { costPerFunded: 4_642, roas: 0.97 } });

describe("buildDirectorReport", () => {
  it("blends the four channels into totals with funded customers and revenue", () => {
    const r = buildDirectorReport({ current: cur, previous: prev, generatedAt: NOW });
    expect(r.totals.current).toMatchObject({ spend: 80_000, funded: 24, revenue: 103_000, leads: 160 });
    expect(r.channels.map((c) => c.channel)).toEqual(["meta", "google", "referral", "partner"]);
    expect(r.channels.find((c) => c.channel === "referral")!.current.spend).toBeNull();
  });

  it("cost per funded customer and return are the provider's figures, passed through (the report divides nothing)", () => {
    const r = buildDirectorReport({ current: cur, previous: prev, generatedAt: NOW });
    expect(r.totals.current.costPerFunded).toBe(4_444);
    expect(r.totals.current.roas).toBe(1.125);
    expect(r.totals.previous?.costPerFunded).toBe(4_642);
    const meta = r.channels.find((c) => c.channel === "meta")!;
    expect(meta.current).toMatchObject({ costPerFunded: 2_778, roas: 1.8 });
  });

  it("compares with the previous period, and only when there is one", () => {
    const r = buildDirectorReport({ current: cur, previous: prev, generatedAt: NOW });
    expect(r.totals.delta?.funded).toMatchObject({ abs: 24 - 19 });
    expect(buildDirectorReport({ current: cur, previous: null, generatedAt: NOW }).totals.delta).toBeNull();
  });

  it("writes wins, risks and next actions in plain English from the numbers", () => {
    const r = buildDirectorReport({ current: cur, previous: prev, generatedAt: NOW });
    expect(r.wins.join(" ")).toMatch(/funded customers rose from 19 to 24/i);
    expect(r.risks.join(" ")).toMatch(/Google spent .*no customer has funded/i);
    expect(r.nextActions.length).toBeGreaterThan(0);
    expect(r.nextActions.every((a) => a.length > 20)).toBe(true);
  });

  it("says nothing it cannot back: no previous period means no comparison sentences", () => {
    const r = buildDirectorReport({ current: cur, previous: null, generatedAt: NOW });
    expect([...r.wins, ...r.risks].join(" ")).not.toMatch(/rose|fell|up from|down from/i);
  });

  it("does not claim a trend on tiny numbers", () => {
    const small = period("2026-09-29", "2026-10-05", [ch("meta", { spend: 1000, leads: 3, kyc: 1, funded: 2, revenue: 100 })]);
    const small0 = period("2026-09-22", "2026-09-28", [ch("meta", { spend: 1000, leads: 3, kyc: 0, funded: 1, revenue: 0 })]);
    const r = buildDirectorReport({ current: small, previous: small0, generatedAt: NOW });
    expect(r.wins.join(" ")).not.toMatch(/rose/);
    expect(r.nextActions.join(" ")).toMatch(/too few funded customers/i);
  });

  it("marks stale ad data and shows the age", () => {
    const old = { ...cur, asOf: { ...cur.asOf, meta: "2026-10-01T06:00:00Z" } };
    const r = buildDirectorReport({ current: old, previous: prev, generatedAt: NOW });
    const meta = r.freshness.find((f) => f.channel === "meta")!;
    expect(meta.stale).toBe(true);
    expect(meta.ageHours).toBe(120);
    expect(r.risks.join(" ")).toMatch(/Meta data is 5 days old/i);
  });

  it("a channel that is not connected is listed as not available, never as zero", () => {
    const missing = period("2026-09-29", "2026-10-05", [ch("meta"), off("google")]);
    const r = buildDirectorReport({ current: missing, previous: null, generatedAt: NOW });
    const g = r.channels.find((c) => c.channel === "google")!;
    expect(g.available).toBe(false);
    expect(g.current.funded).toBeNull();
    expect(r.totals.current.funded).toBe(3);
  });

  it("has no data at all: hasData is false and nothing is invented", () => {
    const none = period("2026-09-29", "2026-10-05", [off("meta")]);
    const r = buildDirectorReport({ current: none, previous: null, generatedAt: NOW });
    expect(r.hasData).toBe(false);
    expect(r.wins).toEqual([]);
    expect(r.totals.current.funded).toBeNull();
  });

  it("carries no customer data: only channel, campaign names and aggregates", () => {
    const withCampaign = { ...cur, campaigns: [{ channel: "meta" as const, campaignId: "c1", name: "Demat basics", spend: 10_000, leads: 20, funded: 5, revenue: 20_000 }] };
    const json = JSON.stringify(buildDirectorReport({ current: withCampaign, previous: prev, generatedAt: NOW }));
    expect(json).not.toMatch(/clientId|email|phone|pan\b/i);
    expect(JSON.parse(json).campaigns[0]).toMatchObject({ name: "Demat basics", funded: 5 });
  });
});
