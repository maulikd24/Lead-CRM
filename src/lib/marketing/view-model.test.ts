import { describe, expect, it } from "vitest";
import { connectionView, formatCount, formatMoney, formatPercent, formatRatio, funnelBars, parseRange, sortCampaigns } from "./view-model";
import type { CampaignRow } from "./metrics";

describe("parseRange", () => {
  const today = "2026-10-09";
  it("defaults to the last 30 days including today", () => {
    expect(parseRange({}, today)).toEqual({ from: "2026-09-10", to: "2026-10-09", preset: "30d" });
  });
  it("supports presets", () => {
    expect(parseRange({ range: "7d" }, today)).toMatchObject({ from: "2026-10-03", to: "2026-10-09", preset: "7d" });
    expect(parseRange({ range: "90d" }, today)).toMatchObject({ from: "2026-07-12", preset: "90d" });
  });
  it("accepts a valid custom range and swaps nothing silently: an inverted range falls back to the default", () => {
    expect(parseRange({ from: "2026-09-01", to: "2026-09-15" }, today)).toEqual({ from: "2026-09-01", to: "2026-09-15", preset: "custom" });
    expect(parseRange({ from: "2026-09-15", to: "2026-09-01" }, today).preset).toBe("30d");
  });
  it("allows at most 90 days, the history the sync keeps", () => {
    expect(parseRange({ from: "2026-07-12", to: "2026-10-09" }, today)).toMatchObject({ preset: "custom" });
    expect(parseRange({ from: "2026-07-11", to: "2026-10-09" }, today).preset).toBe("30d");
  });
  it("rejects junk, future ends and ranges over a year", () => {
    expect(parseRange({ from: "nope", to: "2026-09-01" }, today).preset).toBe("30d");
    expect(parseRange({ from: "2026-09-01", to: "2027-01-01" }, today).preset).toBe("30d");
    expect(parseRange({ from: "2024-01-01", to: "2026-09-01" }, today).preset).toBe("30d");
    expect(parseRange({ range: ["7d", "30d"] }, today).preset).toBe("30d");
  });
});

describe("formatting", () => {
  it("formats money in the account currency with no decimals for large values", () => {
    expect(formatMoney(1234567, "INR")).toMatch(/12,34,567/);
    expect(formatMoney(null, "INR")).toBe("–");
    expect(formatMoney(12.5, "INR")).toMatch(/12\.50|12\.5/);
  });
  it("formats counts, percents and ratios, with a dash for no value", () => {
    expect(formatCount(12345)).toBe("12,345");
    expect(formatPercent(0.1234)).toBe("12.3%");
    expect(formatPercent(null)).toBe("–");
    expect(formatRatio(33.333)).toBe("33.3×");
    expect(formatRatio(null)).toBe("–");
  });
});

describe("funnelBars", () => {
  it("scales widths logarithmically between a minimum and 100, so the small end stays visible", () => {
    const bars = funnelBars([
      { key: "impressions", label: "Impressions", value: 1_000_000, rateFromPrevious: null },
      { key: "clicks", label: "Clicks", value: 20_000, rateFromPrevious: 0.02 },
      { key: "leads", label: "Leads", value: 400, rateFromPrevious: 0.02 },
      { key: "kyc", label: "KYC approved", value: 120, rateFromPrevious: 0.3 },
      { key: "funded", label: "Funded", value: 0, rateFromPrevious: 0 },
    ]);
    expect(bars[0].widthPct).toBe(100);
    expect(bars.map((b) => b.widthPct)).toEqual([...bars.map((b) => b.widthPct)].sort((a, b) => b - a));
    expect(bars[4].widthPct).toBeGreaterThanOrEqual(2);
    expect(bars[3].widthPct).toBeGreaterThan(bars[4].widthPct);
  });
  it("handles an all-zero funnel", () => {
    expect(funnelBars([{ key: "impressions", label: "Impressions", value: 0, rateFromPrevious: null }])[0].widthPct).toBeGreaterThanOrEqual(2);
  });
});

describe("connectionView", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  const base = { live: true, syncEnabled: true, hasData: true, lastSuccessAt: new Date("2026-10-09T08:00:00Z"), lastRun: { status: "SUCCESS", error: null as string | null, startedAt: new Date("2026-10-09T08:00:00Z") }, now };

  it("is not connected when nothing is live and no data was ever synced", () => {
    expect(connectionView({ ...base, live: false, hasData: false, lastSuccessAt: null, lastRun: null }).state).toBe("not_connected");
  });
  it("shows a setup failure even before anything is connected", () => {
    const v = connectionView({ ...base, live: false, hasData: false, lastSuccessAt: null, lastRun: { status: "FAILED", error: "Stored credentials could not be read.", startedAt: new Date("2026-10-09T11:00:00Z") } });
    expect(v.state).toBe("not_connected");
    expect(v.banners[0]).toMatchObject({ tone: "destructive" });
    expect(v.banners[0].text).toContain("Stored credentials could not be read");
  });
  it("still shows stored data when the integration was switched off later, with a note", () => {
    const v = connectionView({ ...base, live: false });
    expect(v.state).toBe("ready");
    expect(v.banners.some((b) => /not connected|switched off/i.test(b.text))).toBe(true);
  });
  it("waits for the first sync when connected but empty", () => {
    expect(connectionView({ ...base, hasData: false, lastSuccessAt: null, lastRun: null }).state).toBe("waiting");
  });
  it("tells the truth when the sync flag is off", () => {
    const v = connectionView({ ...base, syncEnabled: false, hasData: false, lastSuccessAt: null, lastRun: null });
    expect(v.state).toBe("waiting");
    expect(v.banners[0].text).toMatch(/META_ADS_SYNC_ENABLED/);
  });
  it("is quiet and fresh after a recent success", () => {
    expect(connectionView(base)).toMatchObject({ state: "ready", banners: [], lastSyncLabel: expect.stringMatching(/4 hours ago/) });
  });
  it("warns when data is stale (over 36 hours)", () => {
    const v = connectionView({ ...base, lastSuccessAt: new Date("2026-10-07T00:00:00Z"), lastRun: { status: "SUCCESS", error: null, startedAt: new Date("2026-10-07T00:00:00Z") } });
    expect(v.banners.map((b) => b.tone)).toContain("warning");
    expect(v.banners.map((b) => b.text).join(" ")).toMatch(/older than|stale|behind/i);
  });
  it("surfaces the last failure with its safe message, and a rate limit as a pause", () => {
    const failed = connectionView({ ...base, lastRun: { status: "FAILED", error: "Meta rejected the access token or its permissions (HTTP 401)", startedAt: new Date("2026-10-09T11:00:00Z") } });
    expect(failed.banners[0]).toMatchObject({ tone: "destructive" });
    expect(failed.banners[0].text).toContain("rejected the access token");
    const limited = connectionView({ ...base, lastRun: { status: "RATE_LIMITED", error: "x", startedAt: new Date("2026-10-09T11:00:00Z") } });
    expect(limited.banners[0].text).toMatch(/rate limit/i);
  });
});

describe("sortCampaigns", () => {
  const rows = [
    { campaignId: "a", name: "Bravo", spend: 10, cpl: null, funded: 2 },
    { campaignId: "b", name: "alpha", spend: 30, cpl: 5, funded: 0 },
    { campaignId: "c", name: "Charlie", spend: 20, cpl: 2, funded: 1 },
  ] as unknown as CampaignRow[];
  it("sorts numbers both ways and puts missing values last either way", () => {
    expect(sortCampaigns(rows, "spend", "desc").map((r) => r.campaignId)).toEqual(["b", "c", "a"]);
    expect(sortCampaigns(rows, "cpl", "asc").map((r) => r.campaignId)).toEqual(["c", "b", "a"]);
    expect(sortCampaigns(rows, "cpl", "desc").map((r) => r.campaignId)).toEqual(["b", "c", "a"]);
  });
  it("sorts names case-insensitively and never mutates its input", () => {
    expect(sortCampaigns(rows, "name", "asc").map((r) => r.campaignId)).toEqual(["b", "a", "c"]);
    expect(rows.map((r) => r.campaignId)).toEqual(["a", "b", "c"]);
  });
});

describe("connectionView for another channel", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  const base = { live: true, syncEnabled: false, hasData: false, lastSuccessAt: null, lastRun: null as { status: string; error: string | null; startedAt: Date } | null, now };
  const google = { label: "Google", syncFlag: "GOOGLE_ADS_REPORTING_ENABLED" };

  it("names the channel and its own switch in the banners", () => {
    const v = connectionView({ ...base, channel: google });
    expect(v.banners[0].text).toMatch(/GOOGLE_ADS_REPORTING_ENABLED/);
    expect(v.banners[0].text).not.toMatch(/Meta/);
    const limited = connectionView({ ...base, channel: google, syncEnabled: true, lastRun: { status: "RATE_LIMITED", error: null, startedAt: new Date("2026-10-09T11:00:00Z") } });
    expect(limited.banners[0].text).toMatch(/Google asked us to slow down/);
    const off = connectionView({ ...base, channel: google, live: false, hasData: true, lastSuccessAt: new Date("2026-10-09T10:00:00Z") });
    expect(off.banners.map((b) => b.text).join(" ")).toMatch(/Google Ads is not connected/);
  });
});
