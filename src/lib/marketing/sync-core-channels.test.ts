import { describe, expect, it, vi } from "vitest";

import { AdsApiError } from "./ads-error";
import type { CreativeInsightRow, InsightRow } from "./providers/types";
import { runAdsSync, runMetaAdsSync, type SyncDeps, type SyncRunRecord } from "./sync-core";

const NOW = new Date("2026-10-09T06:00:00Z");
const insight = (over: Partial<InsightRow> = {}): InsightRow => ({ campaignId: "g1", campaignName: "Search", date: "2026-10-08", spendMinor: BigInt(5000), currency: "INR", impressions: 100, clicks: 10, reach: 0, leads: 2, ...over });
const creative = (over: Partial<CreativeInsightRow> = {}): CreativeInsightRow => ({ campaignId: "g1", campaignName: "Search", adId: "a1", adName: "Headline A", format: "RESPONSIVE_SEARCH_AD", date: "2026-10-08", spendMinor: BigInt(2000), currency: "INR", impressions: 50, clicks: 5, leads: 1, ...over });

function setup(over: Partial<SyncDeps> = {}) {
  const runs: SyncRunRecord[] = [];
  const rows: unknown[][] = [];
  const creatives: unknown[][] = [];
  const deps: SyncDeps = {
    provider: "google",
    now: () => NOW,
    accountId: "1234567890",
    client: {
      getAccount: vi.fn().mockResolvedValue({ name: "A", currency: "INR", timezoneName: "Asia/Kolkata" }),
      getInsights: vi.fn().mockResolvedValue([insight()]),
      getCreativeInsights: vi.fn().mockResolvedValue([creative()]),
    },
    history: vi.fn().mockResolvedValue({ lastAttemptAt: null, lastSuccessAt: null, lastRateLimitedAt: null }),
    upsertRows: vi.fn().mockImplementation(async (r) => (rows.push(r), r.length)),
    upsertCreativeRows: vi.fn().mockImplementation(async (r) => (creatives.push(r), r.length)),
    recordRun: vi.fn().mockImplementation(async (run) => void runs.push(run)),
    options: { minIntervalHours: 6, trailingDays: 7, backfillDays: 14, windowDays: 7, budgetMs: 60_000, rateLimitCooldownMinutes: 15 },
    ...over,
  };
  return { deps, runs, rows, creatives };
}

describe("runAdsSync for another provider", () => {
  it("tags campaign rows, creative rows and the run ledger with the deps' provider, not Meta", async () => {
    const { deps, runs, rows, creatives } = setup();
    const res = await runAdsSync(deps);
    expect(res.status).toBe("SUCCESS");
    expect(rows[0][0]).toMatchObject({ provider: "google", accountId: "1234567890", campaignId: "g1", accountTimezone: "Asia/Kolkata" });
    expect(creatives[0][0]).toMatchObject({ provider: "google", accountId: "1234567890", adId: "a1", campaignId: "g1", spendMinor: BigInt(2000) });
    expect(runs[0]).toMatchObject({ provider: "google", status: "SUCCESS" });
  });

  it("still defaults to Meta, and runMetaAdsSync is the same function", async () => {
    const { deps, runs } = setup({ provider: undefined });
    await runMetaAdsSync(deps);
    expect(runs[0].provider).toBe("meta");
  });

  it("does not ask for ads when the provider cannot report them or no creative store is given", async () => {
    const noStore = setup({ upsertCreativeRows: undefined });
    await runAdsSync(noStore.deps);
    expect(noStore.deps.client.getCreativeInsights).not.toHaveBeenCalled();
    const plain = setup({ client: { getAccount: vi.fn().mockResolvedValue({ name: "A", currency: "INR", timezoneName: "UTC" }), getInsights: vi.fn().mockResolvedValue([]) } });
    expect((await runAdsSync(plain.deps)).status).toBe("SUCCESS");
    expect(plain.creatives).toHaveLength(0);
  });

  it("a creative failure never fails the run: the campaign data is kept and the note says what was skipped", async () => {
    const getCreativeInsights = vi.fn().mockRejectedValue(new AdsApiError("schema", "An ad row did not have the expected shape."));
    const { deps, runs } = setup({ client: { getAccount: vi.fn().mockResolvedValue({ name: "A", currency: "INR", timezoneName: "UTC" }), getInsights: vi.fn().mockResolvedValue([insight()]), getCreativeInsights } });
    const res = await runAdsSync(deps);
    expect(res.status).toBe("SUCCESS");
    expect(runs[0].error).toMatch(/ad-level/i);
    expect(runs[0].error).toContain("An ad row did not have the expected shape.");
  });

  it("a rate limit while reading ads stops the run as RATE_LIMITED", async () => {
    const getCreativeInsights = vi.fn().mockRejectedValue(new AdsApiError("rate_limit", "Google Ads rate limit reached (HTTP 429)"));
    const { deps } = setup({ client: { getAccount: vi.fn().mockResolvedValue({ name: "A", currency: "INR", timezoneName: "UTC" }), getInsights: vi.fn().mockResolvedValue([insight()]), getCreativeInsights } });
    expect((await runAdsSync(deps)).status).toBe("RATE_LIMITED");
  });

  it("classifies any AdsApiError the way it classifies Meta's (auth stops the run)", async () => {
    const { deps, runs } = setup({ client: { getAccount: vi.fn().mockResolvedValue({ name: "A", currency: "INR", timezoneName: "UTC" }), getInsights: vi.fn().mockRejectedValue(new AdsApiError("auth", "Google Ads rejected the credentials (HTTP 401)")) } });
    const res = await runAdsSync(deps);
    expect(res.status).toBe("FAILED");
    expect(runs[0].error).toBe("Google Ads rejected the credentials (HTTP 401)");
    expect(deps.client.getInsights).toHaveBeenCalledTimes(1);
  });
});
