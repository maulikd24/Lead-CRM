import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  adCampaignDaily: { findFirst: vi.fn(), findMany: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
  adSyncRun: { findFirst: vi.fn() },
  client: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db, basePrisma: db }));
vi.mock("./config", () => ({ getMetaAdsConfig: vi.fn().mockResolvedValue({ live: true }), metaAdsSyncEnabled: () => true }));

import { clearMarketingCache, loadMarketingPage } from "./report";

const NOW = new Date("2026-10-09T06:00:00Z");
const adRow = (over: Record<string, unknown> = {}) => ({ campaignId: "1", campaignName: "New Name", date: new Date("2026-10-05T00:00:00Z"), spendMinor: BigInt(100000), currency: "INR", impressions: 100, clicks: 10, reach: 90, leads: 3, ...over });
const clientRow = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  createdAt: new Date("2026-10-05T20:00:00Z"), // 01:30 on the 6th in Kolkata
  leadSource: "Meta Ads",
  leadAttribution: { source: "meta_leads", campaign: "Old Name" },
  kycRecord: { status: "APPROVED" },
  fundingRecord: null,
  payments: [{ id: "p" }],
  tradingAccounts: [{ transactions: [{ id: "t" }] }],
  revenueEvents: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  clearMarketingCache();
  db.adCampaignDaily.findFirst.mockImplementation(async (a: { select?: unknown }) => (a?.select ? { accountTimezone: "Asia/Kolkata" } : { id: "x" }));
  db.adSyncRun.findFirst.mockResolvedValue({ status: "SUCCESS", startedAt: new Date("2026-10-09T03:00:00Z"), finishedAt: null, error: null, rowsUpserted: 1, windowsOk: 1, windowsFailed: 0 });
  db.adCampaignDaily.findMany.mockResolvedValue([adRow()]);
  db.adCampaignDaily.groupBy.mockResolvedValue([
    { campaignId: "1", campaignName: "Old Name", _max: { date: new Date("2026-09-01T00:00:00Z") } },
    { campaignId: "1", campaignName: "New Name", _max: { date: new Date("2026-10-05T00:00:00Z") } },
  ]);
  db.adCampaignDaily.aggregate.mockResolvedValue({ _min: { date: new Date("2026-08-01T00:00:00Z") } });
  db.client.findMany.mockResolvedValue([clientRow()]);
  db.$queryRaw.mockResolvedValue([{ clientId: "c1", aum: 12345 }]);
});

const range = { from: "2026-10-01", to: "2026-10-09", preset: "custom" as const };

describe("loadMarketingPage", () => {
  it("maps leads to account-timezone days, outcomes, AUM and net revenue", async () => {
    db.client.findMany.mockResolvedValue([
      clientRow({
        revenueEvents: [
          { id: "a", revenueType: "BROKERAGE", grossRevenueAmount: 500, reversesEventId: null, reverses: null },
          { id: "b", revenueType: "TRAIL_COMMISSION", grossRevenueAmount: 900, reversesEventId: null, reverses: null },
          { id: "r", revenueType: "BROKERAGE", grossRevenueAmount: -200, reversesEventId: "a", reverses: { revenueType: "BROKERAGE" } },
        ],
      }),
    ]);
    const data = await loadMarketingPage(() => range, NOW);
    const day = data.report!.daily.find((d) => d.date === "2026-10-06")!;
    expect(day.crmLeads).toBe(1);
    expect(data.report!.totals).toMatchObject({ kyc: 1, funded: 1, firstTransaction: 1, aum: 12345, revenue: 300 });
  });

  it("matches a lead carrying an old campaign name to the renamed campaign (every name pair is passed on)", async () => {
    const data = await loadMarketingPage(() => range, NOW);
    expect(data.report!.campaigns[0]).toMatchObject({ campaignId: "1", crmLeads: 1 });
    expect(data.report!.unattributed.leads).toBe(0);
  });

  it("clamps the range to the first synced spend day and notes it", async () => {
    db.adCampaignDaily.aggregate.mockResolvedValue({ _min: { date: new Date("2026-10-03T00:00:00Z") } });
    const data = await loadMarketingPage(() => range, NOW);
    expect(data.report!.range.from).toBe("2026-10-03");
    expect(data.report!.notes.some((n) => /only available from 2026-10-03/.test(n.text))).toBe(true);
  });

  it("reads the newest leads first and says so when it hits the limit", async () => {
    db.client.findMany.mockResolvedValue(Array.from({ length: 20000 }, (_, i) => clientRow({ id: `c${i}` })));
    const data = await loadMarketingPage(() => range, NOW);
    expect(db.client.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: "desc" });
    expect(data.report!.notes.some((n) => /most recent 20,000 leads/.test(n.text))).toBe(true);
  }, 30_000);

  it("serves a repeat request for the same range from a 60 second cache", async () => {
    await loadMarketingPage(() => range, NOW);
    await loadMarketingPage(() => range, new Date(NOW.getTime() + 30_000));
    expect(db.client.findMany).toHaveBeenCalledTimes(1);
    await loadMarketingPage(() => range, new Date(NOW.getTime() + 90_000));
    expect(db.client.findMany).toHaveBeenCalledTimes(2);
  });
});
