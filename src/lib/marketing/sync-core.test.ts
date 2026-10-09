import { describe, expect, it, vi } from "vitest";
import { MetaAdsError, type InsightRow } from "./meta-ads";
import { runMetaAdsSync, type SyncDeps, type SyncRunRecord } from "./sync-core";

const NOW = new Date("2026-10-09T06:00:00Z"); // 11:30 in Kolkata, still 9 Oct

function insight(over: Partial<InsightRow> = {}): InsightRow {
  return { campaignId: "1", campaignName: "C1", date: "2026-10-08", spendMinor: 1000n, currency: "INR", impressions: 100, clicks: 10, reach: 90, leads: 2, ...over };
}

function setup(over: Partial<SyncDeps> = {}) {
  const runs: SyncRunRecord[] = [];
  const upserts: { rows: unknown[] }[] = [];
  const getInsights = vi.fn().mockResolvedValue([insight()]);
  const deps: SyncDeps = {
    now: () => NOW,
    accountId: "123456",
    client: { getAccount: vi.fn().mockResolvedValue({ name: "A", currency: "INR", timezoneName: "Asia/Kolkata" }), getInsights },
    history: vi.fn().mockResolvedValue({ lastAttemptAt: null, lastSuccessAt: null, lastRateLimitedAt: null }),
    upsertRows: vi.fn().mockImplementation(async (rows) => {
      upserts.push({ rows });
      return rows.length;
    }),
    recordRun: vi.fn().mockImplementation(async (run) => {
      runs.push(run);
    }),
    options: { minIntervalHours: 6, trailingDays: 7, backfillDays: 30, windowDays: 7, budgetMs: 60_000, rateLimitCooldownMinutes: 15 },
    ...over,
  };
  return { deps, runs, upserts, getInsights };
}

describe("runMetaAdsSync", () => {
  it("backfills 30 days in 7-day windows on the first run, then a trailing 7-day window afterwards", async () => {
    const first = setup();
    const res = await runMetaAdsSync(first.deps);
    expect(res.status).toBe("SUCCESS");
    expect(first.getInsights.mock.calls.map((c) => c[0])).toEqual([
      { since: "2026-09-10", until: "2026-09-16" },
      { since: "2026-09-17", until: "2026-09-23" },
      { since: "2026-09-24", until: "2026-09-30" },
      { since: "2026-10-01", until: "2026-10-07" },
      { since: "2026-10-08", until: "2026-10-09" },
    ]);

    const later = setup({ history: vi.fn().mockResolvedValue({ lastAttemptAt: new Date("2026-10-08T20:00:00Z"), lastSuccessAt: new Date("2026-10-08T20:00:00Z"), lastRateLimitedAt: null }) });
    await runMetaAdsSync(later.deps);
    expect(later.getInsights.mock.calls.map((c) => c[0])).toEqual([{ since: "2026-10-03", until: "2026-10-09" }]);
  });

  it("writes rows tagged with the account, timezone and sync time, and records a SUCCESS run with counts", async () => {
    const { deps, runs, upserts } = setup();
    await runMetaAdsSync(deps);
    expect(upserts[0].rows[0]).toMatchObject({ provider: "meta", accountId: "123456", campaignId: "1", spendMinor: 1000n, accountTimezone: "Asia/Kolkata", syncedAt: NOW });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "SUCCESS", windowStart: "2026-09-10", windowEnd: "2026-10-09", windowsOk: 5, windowsFailed: 0, rowsUpserted: 5, campaignsSeen: 1 });
  });

  it("is idempotent: the same insights twice hand identical rows to the upsert", async () => {
    const a = setup();
    const b = setup();
    await runMetaAdsSync(a.deps);
    await runMetaAdsSync(b.deps);
    expect(JSON.stringify(a.upserts, (_, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(JSON.stringify(b.upserts, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  });

  it("skips when an attempt already ran within the minimum interval, without calling Meta", async () => {
    const { deps, runs, getInsights } = setup({ history: vi.fn().mockResolvedValue({ lastAttemptAt: new Date("2026-10-09T02:00:00Z"), lastSuccessAt: new Date("2026-10-09T02:00:00Z"), lastRateLimitedAt: null }) });
    const res = await runMetaAdsSync(deps);
    expect(res).toMatchObject({ status: "SKIPPED", reason: "interval" });
    expect(deps.client.getAccount).not.toHaveBeenCalled();
    expect(getInsights).not.toHaveBeenCalled();
    expect(runs).toHaveLength(0);
  });

  it("runs again once the interval has passed", async () => {
    const { deps } = setup({ history: vi.fn().mockResolvedValue({ lastAttemptAt: new Date("2026-10-08T23:59:00Z"), lastSuccessAt: new Date("2026-10-08T23:59:00Z"), lastRateLimitedAt: null }) });
    expect((await runMetaAdsSync(deps)).status).toBe("SUCCESS");
  });

  it("on a rate limit stops at once, records RATE_LIMITED, and the next tick is not blocked by the interval but by a short cooldown", async () => {
    const { deps, runs, getInsights } = setup();
    getInsights.mockResolvedValueOnce([insight()]).mockRejectedValueOnce(new MetaAdsError("rate_limit", "limit", { status: 429 }));
    const res = await runMetaAdsSync(deps);
    expect(res.status).toBe("RATE_LIMITED");
    expect(getInsights).toHaveBeenCalledTimes(2); // stopped: did not try the remaining windows
    expect(runs[0]).toMatchObject({ status: "RATE_LIMITED", windowsOk: 1 });

    // not an "attempt" for the interval gate (the history helper excludes it) but cooled down for 15 minutes
    const cooling = setup({ history: vi.fn().mockResolvedValue({ lastAttemptAt: null, lastSuccessAt: null, lastRateLimitedAt: new Date("2026-10-09T05:50:00Z") }) });
    expect(await runMetaAdsSync(cooling.deps)).toMatchObject({ status: "SKIPPED", reason: "cooldown" });
    const cooled = setup({ history: vi.fn().mockResolvedValue({ lastAttemptAt: null, lastSuccessAt: null, lastRateLimitedAt: new Date("2026-10-09T05:40:00Z") }) });
    expect((await runMetaAdsSync(cooled.deps)).status).toBe("SUCCESS");
  });

  it("stops on an auth error and records FAILED with a safe message", async () => {
    const { deps, runs, getInsights } = setup();
    getInsights.mockRejectedValue(new MetaAdsError("auth", "Meta rejected the access token or its permissions (HTTP 401)", { status: 401 }));
    const res = await runMetaAdsSync(deps);
    expect(res.status).toBe("FAILED");
    expect(getInsights).toHaveBeenCalledTimes(1);
    expect(runs[0].error).toContain("rejected the access token");
  });

  it("isolates a failing window: later windows still run and the run is PARTIAL", async () => {
    const { deps, runs, getInsights } = setup();
    getInsights.mockResolvedValueOnce([insight()]).mockRejectedValueOnce(new MetaAdsError("schema", "bad row")).mockResolvedValue([insight({ campaignId: "2" })]);
    const res = await runMetaAdsSync(deps);
    expect(res.status).toBe("PARTIAL");
    expect(getInsights).toHaveBeenCalledTimes(5);
    expect(runs[0]).toMatchObject({ status: "PARTIAL", windowsOk: 4, windowsFailed: 1 });
  });

  it("stops at the time budget and reports PARTIAL", async () => {
    let t = NOW.getTime();
    const { deps, getInsights, runs } = setup({ now: () => new Date((t += 20_000)), options: { minIntervalHours: 6, trailingDays: 7, backfillDays: 30, windowDays: 7, budgetMs: 60_000, rateLimitCooldownMinutes: 15 } });
    const res = await runMetaAdsSync(deps);
    expect(res.status).toBe("PARTIAL");
    expect(getInsights.mock.calls.length).toBeLessThan(5);
    expect(runs[0].windowsFailed).toBe(0);
    expect(runs[0].error).toMatch(/time budget/i);
  });

  it("never throws: an unexpected failure (even from the database) becomes a FAILED run with a generic message", async () => {
    const boom = setup({ upsertRows: vi.fn().mockRejectedValue(new Error("connection string postgres://user:pw@host leaked")) });
    const res = await runMetaAdsSync(boom.deps);
    expect(res.status).toBe("FAILED"); // every window failed to write; isolated per window, never thrown
    expect(JSON.stringify(boom.runs)).not.toContain("postgres://");

    const noAccount = setup({ client: { getAccount: vi.fn().mockRejectedValue(new TypeError("kaboom")), getInsights: vi.fn() } });
    expect((await runMetaAdsSync(noAccount.deps)).status).toBe("FAILED");

    const noRecord = setup({ recordRun: vi.fn().mockRejectedValue(new Error("db down")) });
    await expect(runMetaAdsSync(noRecord.deps)).resolves.toBeDefined();

    const noHistory = setup({ history: vi.fn().mockRejectedValue(new Error("db down")) });
    await expect(runMetaAdsSync(noHistory.deps)).resolves.toMatchObject({ status: "FAILED" });
  });
});
