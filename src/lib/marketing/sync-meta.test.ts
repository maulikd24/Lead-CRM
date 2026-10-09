import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  adCampaignDaily: { upsert: vi.fn((args: unknown) => args) },
  adSyncRun: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
}));
vi.mock("@/lib/db/prisma", () => ({ basePrisma: prismaMock, prisma: prismaMock }));
const configMock = vi.hoisted(() => ({ getMetaAdsConfig: vi.fn() }));
vi.mock("./config", async (orig) => ({ ...(await orig<typeof import("./config")>()), getMetaAdsConfig: configMock.getMetaAdsConfig }));

import { syncMetaAds } from "./sync-meta";

const okFetch = () =>
  vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/insights")) {
      return new Response(JSON.stringify({ data: [{ campaign_id: "1", campaign_name: "C", spend: "10.50", impressions: "5", clicks: "1", reach: "5", date_start: "2026-10-08", account_currency: "INR" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ name: "A", currency: "INR", timezone_name: "Asia/Kolkata" }), { status: 200 });
  });

describe("syncMetaAds gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.adSyncRun.findFirst.mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("does nothing, touching neither the database nor the network, unless META_ADS_SYNC_ENABLED=1", async () => {
    const fetchImpl = vi.fn();
    for (const value of [undefined, "0", "true", "yes"]) {
      if (value === undefined) vi.stubEnv("META_ADS_SYNC_ENABLED", ""); else vi.stubEnv("META_ADS_SYNC_ENABLED", value);
      expect(await syncMetaAds({ fetch: fetchImpl as unknown as typeof fetch })).toEqual({ status: "DISABLED" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(configMock.getMetaAdsConfig).not.toHaveBeenCalled();
  });

  it("is a no-op when the integration is not live or has no credentials", async () => {
    vi.stubEnv("META_ADS_SYNC_ENABLED", "1");
    const fetchImpl = vi.fn();
    configMock.getMetaAdsConfig.mockResolvedValue({ live: false });
    expect(await syncMetaAds({ fetch: fetchImpl as unknown as typeof fetch })).toEqual({ status: "NOT_CONFIGURED" });
    configMock.getMetaAdsConfig.mockResolvedValue({ live: true, accountId: "123456" });
    expect(await syncMetaAds({ fetch: fetchImpl as unknown as typeof fetch })).toEqual({ status: "NOT_CONFIGURED" });
    configMock.getMetaAdsConfig.mockRejectedValue(new Error("decrypt failed"));
    expect(await syncMetaAds({ fetch: fetchImpl as unknown as typeof fetch })).toEqual({ status: "NOT_CONFIGURED" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(prismaMock.adCampaignDaily.upsert).not.toHaveBeenCalled();
  });

  it("when live and enabled, reads from Meta with GET only, upserts by the natural key and records the run", async () => {
    vi.stubEnv("META_ADS_SYNC_ENABLED", "1");
    configMock.getMetaAdsConfig.mockResolvedValue({ live: true, accountId: "123456", accessToken: "tok" });
    const fetchImpl = okFetch();
    const res = await syncMetaAds({ fetch: fetchImpl as unknown as typeof fetch, now: () => new Date("2026-10-09T06:00:00Z") });
    expect(res.status).toBe("SUCCESS");
    for (const [, init] of fetchImpl.mock.calls) expect(init.method).toBe("GET");
    const call = prismaMock.adCampaignDaily.upsert.mock.calls[0][0] as { where: { provider_accountId_campaignId_date: Record<string, unknown> }; create: { spendMinor: bigint } };
    expect(call.where.provider_accountId_campaignId_date).toMatchObject({ provider: "meta", accountId: "123456", campaignId: "1" });
    expect(call.create.spendMinor).toBe(1050n);
    expect(prismaMock.adSyncRun.create).toHaveBeenCalledTimes(1);
  });
});
