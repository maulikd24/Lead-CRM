import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  adCampaignDaily: { findFirst: vi.fn(), findMany: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
  adSyncRun: { findFirst: vi.fn() },
  client: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db, basePrisma: db }));
const cfg = vi.hoisted(() => ({ meta: vi.fn(), google: vi.fn(), googleOn: vi.fn() }));
vi.mock("./config", () => ({ getMetaAdsConfig: cfg.meta, metaAdsSyncEnabled: () => true }));
vi.mock("./config-google", () => ({ getGoogleAdsConfig: cfg.google, googleAdsReportingEnabled: cfg.googleOn }));

import { clearMarketingCache, loadMarketingWorkspace } from "./report";

const NOW = new Date("2026-10-09T06:00:00Z");
const range = { from: "2026-10-01", to: "2026-10-09", preset: "custom" as const };

const byProvider = <T,>(meta: T, google: T) => (args: { where?: { provider?: string } }) => (args?.where?.provider === "google" ? google : meta);

function client(id: string, attribution: Record<string, unknown>, leadSource: string, revenue = 0) {
  return {
    id,
    createdAt: new Date("2026-10-05T10:00:00Z"),
    leadSource,
    leadAttribution: attribution,
    kycRecord: { status: "APPROVED" },
    fundingRecord: null,
    payments: [{ id: "p" }],
    tradingAccounts: [],
    revenueEvents: revenue ? [{ id: `e${id}`, revenueType: "BROKERAGE", grossRevenueAmount: revenue, reversesEventId: null, reverses: null }] : [],
  };
}
const ad = (campaignId: string, spendMinor: number) => ({ campaignId, campaignName: `C${campaignId}`, date: new Date("2026-10-05T00:00:00Z"), spendMinor: BigInt(spendMinor), currency: "INR", impressions: 1000, clicks: 40, reach: 0, leads: 3 });

beforeEach(() => {
  vi.clearAllMocks();
  clearMarketingCache();
  cfg.meta.mockResolvedValue({ live: true });
  cfg.google.mockResolvedValue({ live: true });
  cfg.googleOn.mockReturnValue(true);
  db.adCampaignDaily.findFirst.mockImplementation(async (a: { select?: unknown }) => (a?.select ? { accountTimezone: "Asia/Kolkata" } : { id: "x" }));
  db.adSyncRun.findFirst.mockResolvedValue({ status: "SUCCESS", startedAt: new Date("2026-10-09T03:00:00Z"), finishedAt: null, error: null, rowsUpserted: 1, windowsOk: 1, windowsFailed: 0 });
  db.adCampaignDaily.findMany.mockImplementation(byProvider([ad("1", 200000)], [ad("9", 100000)]));
  db.adCampaignDaily.groupBy.mockImplementation(byProvider([{ campaignId: "1", campaignName: "C1", _max: { date: new Date("2026-10-05T00:00:00Z") } }], [{ campaignId: "9", campaignName: "C9", _max: { date: new Date("2026-10-05T00:00:00Z") } }]));
  db.adCampaignDaily.aggregate.mockResolvedValue({ _min: { date: new Date("2026-08-01T00:00:00Z") } });
  db.client.findMany.mockResolvedValue([
    client("m1", { source: "meta_leads", campaign_id: "1" }, "Meta Ads", 600),
    client("g1", { source: "google_ads", campaign: "9" }, "Google Ads", 300),
    client("g2", { gclid: "x", campaign: "9" }, "Google Ads"),
    client("w1", { utm_source: "newsletter" }, "Contact Form"),
  ]);
  db.$queryRaw.mockResolvedValue([]);
});

describe("loadMarketingWorkspace", () => {
  it("builds a report per channel from ONE lead query and blends them", async () => {
    const data = await loadMarketingWorkspace(() => range, NOW);
    expect(db.client.findMany).toHaveBeenCalledTimes(1);
    expect(data.channels.map((c) => c.channel)).toEqual(["meta", "google"]);
    const g = data.channels[1].report!;
    expect(g.totals).toMatchObject({ spend: 1000, crmLeads: 2, revenue: 300 });
    expect(g.campaigns[0]).toMatchObject({ campaignId: "9", crmLeads: 2 });
    expect(data.channels[0].report!.totals).toMatchObject({ spend: 2000, crmLeads: 1, revenue: 600 });
    expect(data.blended!.totals).toMatchObject({ spend: 3000, crmLeads: 3, revenue: 900 });
    expect(data.blended!.totals.roas).toBeCloseTo(0.3, 5);
  });

  it("leaves Google out entirely, without reading its config or rows, when GOOGLE_ADS_REPORTING_ENABLED is off", async () => {
    cfg.googleOn.mockReturnValue(false);
    const data = await loadMarketingWorkspace(() => range, NOW);
    expect(data.channels.map((c) => c.channel)).toEqual(["meta"]);
    expect(cfg.google).not.toHaveBeenCalled();
    expect(db.adCampaignDaily.findMany.mock.calls.every(([a]) => a.where.provider === "meta")).toBe(true);
    expect(data.blended!.channels.map((c) => c.channel)).toEqual(["meta"]);
  });

  it("a channel that is not connected has no report but does not hide the other one", async () => {
    cfg.google.mockResolvedValue({ live: false });
    db.adCampaignDaily.findFirst.mockImplementation(async (a: { select?: unknown; where?: { provider?: string } }) => (a?.where?.provider === "google" ? null : a?.select ? { accountTimezone: "Asia/Kolkata" } : { id: "x" }));
    db.adSyncRun.findFirst.mockImplementation(async (a: { where?: { provider?: string } }) => (a?.where?.provider === "google" ? null : { status: "SUCCESS", startedAt: new Date("2026-10-09T03:00:00Z"), finishedAt: null, error: null, rowsUpserted: 1, windowsOk: 1, windowsFailed: 0 }));
    const data = await loadMarketingWorkspace(() => range, NOW);
    expect(data.channels[1].connection.state).toBe("not_connected");
    expect(data.channels[1].report).toBeNull();
    expect(data.channels[0].report).not.toBeNull();
    expect(data.blended!.channels.map((c) => c.channel)).toEqual(["meta"]);
  });

  it("the Google connection banners name Google and its own switch, not Meta's", async () => {
    cfg.google.mockResolvedValue({ live: true });
    db.adSyncRun.findFirst.mockImplementation(async (a: { where?: { provider?: string } }) => (a?.where?.provider === "google" ? { status: "RATE_LIMITED", startedAt: new Date("2026-10-09T05:00:00Z"), finishedAt: null, error: null, rowsUpserted: 0, windowsOk: 0, windowsFailed: 0 } : { status: "SUCCESS", startedAt: new Date("2026-10-09T03:00:00Z"), finishedAt: null, error: null, rowsUpserted: 1, windowsOk: 1, windowsFailed: 0 }));
    const data = await loadMarketingWorkspace(() => range, NOW);
    const text = data.channels[1].connection.banners.map((b) => b.text).join(" ");
    expect(text).toMatch(/Google/);
    expect(text).not.toMatch(/Meta/);
  });

  it("blended is null when no channel has a report", async () => {
    cfg.meta.mockResolvedValue({ live: false });
    cfg.google.mockResolvedValue({ live: false });
    db.adCampaignDaily.findFirst.mockResolvedValue(null);
    db.adSyncRun.findFirst.mockResolvedValue(null);
    const data = await loadMarketingWorkspace(() => range, NOW);
    expect(data.blended).toBeNull();
  });
});
