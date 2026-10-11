import { describe, expect, it } from "vitest";

import { DEFAULT_FATIGUE_THRESHOLDS } from "./fatigue";
import { buildInsights } from "./insights";
import type { DailySeries, OutcomeRow } from "./outcomes";
import { DEFAULT_WINNER_SETTINGS } from "./winners";

const row = (adId: string, over: Partial<OutcomeRow> = {}): OutcomeRow => ({ level: "ad", channel: "google", campaignId: "c1", campaignName: "Search", adId, adName: `Ad ${adId}`, format: "VIDEO", spend: 1000, currency: "INR", impressions: 5000, clicks: 100, platformLeads: 10, leads: 8, contactedInSla: null, kyc: 4, funded: 2, revenue: 500, outcomes: "crm", ...over });
const flat = (adId: string, days: number, over = {}): DailySeries => ({ channel: "google", level: "ad", campaignId: "c1", adId, name: `Ad ${adId}`, points: Array.from({ length: days }, (_, i) => ({ date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10), impressions: 4000, clicks: 80, spend: 2000, leads: 4, ...over })) });

describe("buildInsights", () => {
  it("one entry per ad, with cost per funded customer only where there is a funded customer", () => {
    const r = buildInsights({ rows: [row("a1", { funded: 2, spend: 1000 }), row("a2", { funded: 0 })], series: [], tags: new Map(), fatigue: DEFAULT_FATIGUE_THRESHOLDS, winners: DEFAULT_WINNER_SETTINGS });
    expect(r.ads.find((a) => a.adId === "a1")!.costPerFunded).toBe(500);
    expect(r.ads.find((a) => a.adId === "a2")!.costPerFunded).toBeNull();
  });

  it("ranks by funded customers, then spend", () => {
    const r = buildInsights({ rows: [row("a1", { funded: 1 }), row("a2", { funded: 5 }), row("a3", { funded: 5, spend: 9000 })], series: [], tags: new Map(), fatigue: DEFAULT_FATIGUE_THRESHOLDS, winners: DEFAULT_WINNER_SETTINGS });
    expect(r.ads.map((a) => a.adId)).toEqual(["a3", "a2", "a1"]);
  });

  it("platform-only rows have no funded numbers and winners say why", () => {
    const r = buildInsights({ rows: [row("a1", { funded: null, leads: null, kyc: null, revenue: null, outcomes: "platform_only" })], series: [], tags: new Map(), fatigue: DEFAULT_FATIGUE_THRESHOLDS, winners: DEFAULT_WINNER_SETTINGS });
    expect(r.ads[0].funded).toBeNull();
    expect(r.winners.state).toBe("not_enough_data");
    expect(r.winners.reason).toMatch(/ad id/i);
    expect(r.fundedKnown).toBe(false);
  });

  it("attaches fatigue from the daily series, matched by channel and ad", () => {
    const r = buildInsights({ rows: [row("a1")], series: [flat("a1", 14, {}), flat("zz", 14)], tags: new Map(), fatigue: DEFAULT_FATIGUE_THRESHOLDS, winners: DEFAULT_WINNER_SETTINGS });
    expect(r.ads[0].fatigue?.status).toBe("ok");
    expect(r.fatiguedCount).toBe(0);
  });

  it("counts fatigued ads", () => {
    const tired: DailySeries = { ...flat("a1", 14), points: flat("a1", 14).points.map((p, i) => ({ ...p, clicks: i < 9 ? 100 : 50, leads: i < 9 ? 5 : 2 })) };
    const r = buildInsights({ rows: [row("a1")], series: [tired], tags: new Map(), fatigue: DEFAULT_FATIGUE_THRESHOLDS, winners: DEFAULT_WINNER_SETTINGS });
    expect(r.fatiguedCount).toBe(1);
  });

  it("an ad with no series yet gets no fatigue verdict, not a healthy one", () => {
    const r = buildInsights({ rows: [row("a1")], series: [], tags: new Map(), fatigue: DEFAULT_FATIGUE_THRESHOLDS, winners: DEFAULT_WINNER_SETTINGS });
    expect(r.ads[0].fatigue).toBeNull();
  });

  it("carries stored tags and their draft status into the winners analysis", () => {
    const tags = new Map([["google:a1", { tags: { hook: "question" }, status: "DRAFT" as const, sources: { hook: "RULE" } }]]);
    const r = buildInsights({ rows: [row("a1")], series: [], tags, fatigue: DEFAULT_FATIGUE_THRESHOLDS, winners: DEFAULT_WINNER_SETTINGS });
    expect(r.ads[0].tags).toEqual({ hook: "question" });
    expect(r.ads[0].tagStatus).toBe("DRAFT");
  });
});
