import { describe, expect, it } from "vitest";

import type { BlendedTotals } from "./blend";
import { channelFacts, overviewKpis } from "./workspace-view";

const totals: BlendedTotals = { spend: 3000, impressions: 5000, clicks: 100, ctr: 0.02, crmLeads: 5, kyc: 3, funded: 2, aum: 15000, revenue: 900, cpl: 600, costPerFunded: 1500, roas: 0.3 };

describe("overviewKpis", () => {
  it("gives the six blended numbers in reading order", () => {
    const k = overviewKpis(totals);
    expect(k.map((x) => x.key)).toEqual(["spend", "leads", "cpl", "funded", "revenue", "roas"]);
    expect(k.find((x) => x.key === "spend")).toMatchObject({ value: 3000, kind: "money" });
    expect(k.find((x) => x.key === "leads")).toMatchObject({ value: 5, kind: "count" });
    expect(k.find((x) => x.key === "funded")!.hint).toMatch(/₹1,500 each/);
    expect(k.find((x) => x.key === "roas")).toMatchObject({ value: 0.3, kind: "ratio" });
  });
  it("says so when there is no revenue yet instead of showing a zero return", () => {
    const k = overviewKpis({ ...totals, revenue: 0, roas: null, funded: 0, costPerFunded: null });
    expect(k.find((x) => x.key === "roas")).toMatchObject({ value: null });
    expect(k.find((x) => x.key === "roas")!.hint).toMatch(/revenue/i);
    expect(k.find((x) => x.key === "funded")!.hint).toMatch(/no funded customers yet/i);
  });
});

describe("channelFacts", () => {
  const base = { channel: "meta" as const, label: "Meta" };
  it("one fact per channel with its state in plain words", () => {
    const f = channelFacts([
      { ...base, connection: { state: "ready", banners: [], lastSyncLabel: "3 hours ago" } },
      { channel: "google", label: "Google", connection: { state: "not_connected", banners: [], lastSyncLabel: null } },
      { channel: "google", label: "Google", connection: { state: "waiting", banners: [], lastSyncLabel: null } },
    ]);
    expect(f[0]).toMatchObject({ label: "Meta Ads", value: "Live", hint: "Last sync 3 hours ago", live: true });
    expect(f[1]).toMatchObject({ value: "Not connected", tone: "warning" });
    expect(f[2]).toMatchObject({ value: "Waiting for first sync" });
  });
  it("a warning banner turns a ready channel into 'Needs attention' and stops the live pulse", () => {
    const f = channelFacts([{ ...base, connection: { state: "ready", banners: [{ tone: "warning", text: "The numbers are older than 36 hours" }], lastSyncLabel: "2 days ago" } }]);
    expect(f[0]).toMatchObject({ value: "Needs attention", tone: "warning", live: false });
  });
  it("a destructive banner is an error", () => {
    const f = channelFacts([{ ...base, connection: { state: "ready", banners: [{ tone: "destructive", text: "The last sync failed" }], lastSyncLabel: null } }]);
    expect(f[0]).toMatchObject({ value: "Sync failing", tone: "destructive" });
  });
});
