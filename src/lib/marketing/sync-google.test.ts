import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  adCampaignDaily: { upsert: vi.fn((args: unknown) => args) },
  adCreativeDaily: { upsert: vi.fn((args: unknown) => args) },
  adSyncRun: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
}));
vi.mock("@/lib/db/prisma", () => ({ basePrisma: prismaMock, prisma: prismaMock }));
const configMock = vi.hoisted(() => ({ getGoogleAdsConfig: vi.fn() }));
vi.mock("./config-google", async (orig) => ({ ...(await orig<typeof import("./config-google")>()), getGoogleAdsConfig: configMock.getGoogleAdsConfig }));

import { syncGoogleAds } from "./sync-google";

const LIVE = { live: true, customerId: "1234567890", developerToken: "dev", clientId: "cid", clientSecret: "sec", refreshToken: "ref" };

function okFetch() {
  return vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
    if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "acc", expires_in: 3600 }), { status: 200 });
    const query = JSON.parse(String(init.body)).query as string;
    if (query.includes("FROM customer")) return new Response(JSON.stringify({ results: [{ customer: { descriptiveName: "A", currencyCode: "INR", timeZone: "Asia/Kolkata" } }] }), { status: 200 });
    if (query.includes("FROM ad_group_ad")) {
      return new Response(JSON.stringify({ results: [{ campaign: { id: "5", name: "C" }, adGroupAd: { ad: { id: "9", name: "Ad nine" } }, segments: { date: "2026-10-08" }, metrics: { costMicros: "1000000", impressions: "5", clicks: "1", conversions: 0 } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ results: [{ campaign: { id: "5", name: "C" }, segments: { date: "2026-10-08" }, metrics: { costMicros: "10500000", impressions: "5", clicks: "1", conversions: 1 } }] }), { status: 200 });
  });
}

describe("syncGoogleAds gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.adSyncRun.findFirst.mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("does nothing, touching neither the database nor the network, unless GOOGLE_ADS_REPORTING_ENABLED=1", async () => {
    const fetchImpl = vi.fn();
    for (const value of ["", "0", "true", "yes"]) {
      vi.stubEnv("GOOGLE_ADS_REPORTING_ENABLED", value);
      expect(await syncGoogleAds({ fetch: fetchImpl as unknown as typeof fetch })).toEqual({ status: "DISABLED" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(configMock.getGoogleAdsConfig).not.toHaveBeenCalled();
  });

  it("is a no-op when the integration is not live or a credential is missing", async () => {
    vi.stubEnv("GOOGLE_ADS_REPORTING_ENABLED", "1");
    const fetchImpl = vi.fn();
    configMock.getGoogleAdsConfig.mockResolvedValue({ live: false });
    expect(await syncGoogleAds({ fetch: fetchImpl as unknown as typeof fetch })).toEqual({ status: "NOT_CONFIGURED" });
    configMock.getGoogleAdsConfig.mockResolvedValue({ ...LIVE, refreshToken: undefined });
    expect(await syncGoogleAds({ fetch: fetchImpl as unknown as typeof fetch })).toEqual({ status: "NOT_CONFIGURED" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(prismaMock.adSyncRun.create).not.toHaveBeenCalled();
  });

  it("records a FAILED run with a safe message when stored credentials cannot be read", async () => {
    vi.stubEnv("GOOGLE_ADS_REPORTING_ENABLED", "1");
    configMock.getGoogleAdsConfig.mockRejectedValue(new Error("bad decrypt of secret-value"));
    const res = await syncGoogleAds({ fetch: vi.fn() as unknown as typeof fetch });
    expect(res).toMatchObject({ status: "FAILED" });
    const data = prismaMock.adSyncRun.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ provider: "google", status: "FAILED", error: "Stored credentials could not be read." });
    expect(JSON.stringify(data)).not.toContain("secret-value");
  });

  it("records a FAILED run when the customer id is invalid", async () => {
    vi.stubEnv("GOOGLE_ADS_REPORTING_ENABLED", "1");
    configMock.getGoogleAdsConfig.mockResolvedValue({ ...LIVE, customerId: "nope" });
    const res = await syncGoogleAds({ fetch: vi.fn() as unknown as typeof fetch });
    expect(res).toMatchObject({ status: "FAILED" });
    expect(prismaMock.adSyncRun.create.mock.calls[0][0].data).toMatchObject({ provider: "google", error: "The customer id is invalid.", accountId: null });
  });

  it("when live and enabled it reads, upserts campaign and ad rows by their natural keys under provider google, and records the run", async () => {
    vi.stubEnv("GOOGLE_ADS_REPORTING_ENABLED", "1");
    configMock.getGoogleAdsConfig.mockResolvedValue(LIVE);
    const fetchImpl = okFetch();
    const res = await syncGoogleAds({ fetch: fetchImpl as unknown as typeof fetch, now: () => new Date("2026-10-09T06:00:00Z") });
    expect(res.status).toBe("SUCCESS");
    for (const [url] of fetchImpl.mock.calls) expect(String(url)).toMatch(/oauth2\.googleapis\.com\/token$|googleAds:search$/);
    const camp = prismaMock.adCampaignDaily.upsert.mock.calls[0][0] as { where: { provider_accountId_campaignId_date: Record<string, unknown> }; create: { spendMinor: bigint; leads: number } };
    expect(camp.where.provider_accountId_campaignId_date).toMatchObject({ provider: "google", accountId: "1234567890", campaignId: "5" });
    expect(camp.create).toMatchObject({ spendMinor: BigInt(1050), leads: 1 });
    const ad = prismaMock.adCreativeDaily.upsert.mock.calls[0][0] as { where: { provider_accountId_adId_date: Record<string, unknown> } };
    expect(ad.where.provider_accountId_adId_date).toMatchObject({ provider: "google", adId: "9" });
    expect(prismaMock.adSyncRun.create.mock.calls[0][0].data).toMatchObject({ provider: "google", status: "SUCCESS" });
  });
});
