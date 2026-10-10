import { describe, expect, it, vi } from "vitest";
import { MetaAdsError, type InsightRow } from "./meta-ads";
import { runMetaAdsSync, DEFAULT_SYNC_OPTIONS, type SyncDeps, type SyncRunRecord } from "./sync-core";

const NOW = new Date("2026-10-09T06:00:00Z");
const row = (): InsightRow => ({ campaignId: "1", campaignName: "C", date: "2026-10-08", spendMinor: BigInt(100), currency: "INR", impressions: 1, clicks: 1, reach: 1, leads: 1 });

function setup(history: { success: Date | null; attempt?: Date | null }, over: Partial<SyncDeps> = {}) {
  const runs: SyncRunRecord[] = [];
  const getInsights = vi.fn().mockResolvedValue([row()]);
  const deps: SyncDeps = {
    now: () => NOW,
    accountId: "123456",
    client: { getAccount: vi.fn().mockResolvedValue({ name: "A", currency: "INR", timezoneName: "Asia/Kolkata" }), getInsights },
    history: async () => ({ lastAttemptAt: history.attempt ?? null, lastSuccessAt: history.success, lastRateLimitedAt: null }),
    upsertRows: async (r) => r.length,
    recordRun: async (r) => void runs.push(r),
    options: DEFAULT_SYNC_OPTIONS,
    ...over,
  };
  return { deps, runs, getInsights };
}

describe("sync window sizing", () => {
  it("defaults to a 90-day backfill", () => {
    expect(DEFAULT_SYNC_OPTIONS.backfillDays).toBe(90);
  });
  it("fills a 20-day outage: days since the last success plus the trailing week", async () => {
    const { deps, runs } = setup({ success: new Date("2026-09-19T01:00:00Z") });
    await runMetaAdsSync(deps);
    expect(runs[0].windowStart).toBe("2026-09-13"); // 20 days since 19 Sep + 7 = 27 days ending 9 Oct
    expect(runs[0].windowEnd).toBe("2026-10-09");
  });
  it("never reads more than the backfill window after a very long outage", async () => {
    const { deps, runs } = setup({ success: new Date("2025-01-01T00:00:00Z") });
    await runMetaAdsSync(deps);
    expect(runs[0].windowStart).toBe("2026-07-12");
  });
  it("measures from the last SUCCESS, so a recent PARTIAL attempt does not shrink the window", async () => {
    const { deps, runs } = setup({ success: new Date("2026-09-29T01:00:00Z"), attempt: new Date("2026-10-08T00:00:00Z") });
    await runMetaAdsSync(deps);
    expect(runs[0].windowStart).toBe("2026-09-23"); // 10 + 7 = 17 days
  });
  it("uses the trailing 7 days after a success earlier the same day", async () => {
    const { deps, runs } = setup({ success: new Date("2026-10-09T00:30:00Z") });
    await runMetaAdsSync(deps);
    expect(runs[0].windowStart).toBe("2026-10-03");
  });
});

describe("deadline and skipped rows", () => {
  it("hands every Meta call an absolute deadline = start + budget", async () => {
    const { deps, getInsights } = setup({ success: null });
    await runMetaAdsSync(deps);
    expect(getInsights.mock.calls[0][0].deadlineMs).toBe(NOW.getTime() + 60_000);
  });
  it("a deadline hit inside a window is a PARTIAL outcome, not a failure or a throw", async () => {
    const { deps, runs, getInsights } = setup({ success: null });
    getInsights.mockResolvedValueOnce([row()]).mockRejectedValue(new MetaAdsError("deadline", "Time budget reached"));
    const res = await runMetaAdsSync(deps);
    expect(res.status).toBe("PARTIAL");
    expect(getInsights).toHaveBeenCalledTimes(2);
    expect(runs[0]).toMatchObject({ status: "PARTIAL", windowsOk: 1, windowsFailed: 0 });
  });
  it("is PARTIAL even when the very first window hits the deadline", async () => {
    const { deps, getInsights } = setup({ success: null });
    getInsights.mockRejectedValue(new MetaAdsError("deadline", "x"));
    expect((await runMetaAdsSync(deps)).status).toBe("PARTIAL");
  });
  it("counts rows skipped for a missing campaign id and records the count without failing the run", async () => {
    const { deps, runs, getInsights } = setup({ success: null });
    getInsights.mockImplementation(async (p: { onSkip?: (n: number) => void }) => {
      p.onSkip?.(2);
      return [row()];
    });
    const res = await runMetaAdsSync(deps);
    expect(res.status).toBe("SUCCESS");
    expect(runs[0].error).toMatch(/Skipped 26 rows/);
  });
});
