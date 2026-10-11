import { describe, expect, it } from "vitest";

import { RETENTION_DAYS, TICK_BATCH, planPrune, pruneJobRuns, type RetentionStore } from "./job-retention";

const NOW = new Date("2027-04-20T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("planPrune", () => {
  it("keeps skipped rows 3 days, ok cron rows 14, ok webhook rows 7, every bad outcome 90", () => {
    expect(RETENTION_DAYS).toEqual({ skipped: 3, okCron: 14, okWebhook: 7, bad: 90, resolvedAlerts: 180 });
    const rules = planPrune(NOW);
    const find = (name: string) => rules.find((r) => r.name === name)!;
    expect(find("skipped")).toMatchObject({ statuses: ["SKIPPED"], olderThan: daysAgo(3) });
    expect(find("ok-cron")).toMatchObject({ statuses: ["OK"], kinds: ["CRON", "MANUAL", "RETRY"], olderThan: daysAgo(14) });
    expect(find("ok-webhook")).toMatchObject({ statuses: ["OK"], kinds: ["WEBHOOK"], olderThan: daysAgo(7) });
    expect(find("bad").statuses.sort()).toEqual(["ABANDONED", "FAILED", "REJECTED", "TIMEOUT"]);
    expect(find("bad").olderThan).toEqual(daysAgo(90));
  });
  it("never targets a RUNNING row", () => expect(planPrune(NOW).some((r) => r.statuses.includes("RUNNING"))).toBe(false));
  it("always keeps the newest row per job", () => expect(planPrune(NOW).every((r) => r.keepNewestPerJob)).toBe(true));
});

describe("pruneJobRuns", () => {
  it("spends one shared batch budget across the rules and then the resolved alerts", async () => {
    const calls: { name: string; limit: number }[] = [];
    const store: RetentionStore = {
      deleteRuns: async (rule, limit) => { calls.push({ name: rule.name, limit }); return Math.min(limit, 4000); },
      deleteResolvedAlerts: async (_older, limit) => { calls.push({ name: "alerts", limit }); return 1; },
    };
    const out = await pruneJobRuns(store, NOW);
    expect(TICK_BATCH).toBe(5000);
    expect(calls[0]).toEqual({ name: "skipped", limit: 5000 });
    expect(calls[1]).toEqual({ name: "ok-cron", limit: 1000 });
    expect(out.runs).toBe(5000);
    expect(calls.some((c) => c.name === "bad")).toBe(false); // budget exhausted this tick; the next tick continues
    expect(out.alerts).toBe(1);
  });
  it("reports zeros on an empty history", async () => {
    const store: RetentionStore = { deleteRuns: async () => 0, deleteResolvedAlerts: async () => 0 };
    expect(await pruneJobRuns(store, NOW)).toEqual({ runs: 0, alerts: 0 });
  });
});
