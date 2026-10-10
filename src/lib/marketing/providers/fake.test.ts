import { describe, expect, it } from "vitest";

import { AdsApiError } from "../ads-error";
import { createFakeAdProvider } from "./fake";

const spec = { channel: "google" as const, account: { name: "Demo", currency: "INR", timezoneName: "Asia/Kolkata" }, campaigns: [{ id: "g1", name: "Search - Demat", dailySpend: 1500, ctr: 0.04, leadRate: 0.08, ads: ["Headline A", "Headline B"] }, { id: "g2", name: "PMax", dailySpend: 800, ctr: 0.02, leadRate: 0.05 }] };

describe("createFakeAdProvider", () => {
  it("returns one row per campaign per day of the window, in minor units", async () => {
    const p = createFakeAdProvider(spec);
    const rows = await p.getInsights({ since: "2026-10-01", until: "2026-10-03" });
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.currency === "INR" && typeof r.spendMinor === "bigint" && r.spendMinor > BigInt(0))).toBe(true);
    expect(new Set(rows.map((r) => r.date))).toEqual(new Set(["2026-10-01", "2026-10-02", "2026-10-03"]));
  });

  it("is deterministic: the same window gives the same numbers", async () => {
    const a = await createFakeAdProvider(spec).getInsights({ since: "2026-10-01", until: "2026-10-05" });
    const b = await createFakeAdProvider(spec).getInsights({ since: "2026-10-01", until: "2026-10-05" });
    expect(a).toEqual(b);
  });

  it("keeps clicks under impressions and leads under clicks", async () => {
    const rows = await createFakeAdProvider(spec).getInsights({ since: "2026-09-01", until: "2026-09-30" });
    for (const r of rows) {
      expect(r.clicks).toBeLessThanOrEqual(r.impressions);
      expect(r.leads).toBeLessThanOrEqual(r.clicks);
    }
  });

  it("reports ads for campaigns that list them", async () => {
    const rows = await createFakeAdProvider(spec).getCreativeInsights!({ since: "2026-10-01", until: "2026-10-02" });
    expect(new Set(rows.map((r) => r.adName))).toEqual(new Set(["Headline A", "Headline B"]));
    expect(rows.every((r) => r.campaignId === "g1")).toBe(true);
  });

  it("can be told to fail, with the same typed errors as a real client", async () => {
    const p = createFakeAdProvider({ ...spec, failWith: new AdsApiError("rate_limit", "slow down") });
    await expect(p.getInsights({ since: "2026-10-01", until: "2026-10-01" })).rejects.toMatchObject({ kind: "rate_limit" });
  });

  it("honours the deadline and the skip counter contract (never skips)", async () => {
    const p = createFakeAdProvider({ ...spec, now: () => 5000 });
    await expect(p.getInsights({ since: "2026-10-01", until: "2026-10-01", deadlineMs: 1000 })).rejects.toMatchObject({ kind: "deadline" });
  });
});
