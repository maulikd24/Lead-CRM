import { describe, expect, it } from "vitest";

import { estimateFunnel, wilson, type FunnelHistoryRow } from "./funnel";

const row = (leads: number, kyc: number, funded: number, budgetInr: number | null = null): FunnelHistoryRow => ({ leads, kyc, funded, budgetInr });

describe("wilson interval", () => {
  it("brackets the observed rate and stays inside 0..1", () => {
    const w = wilson(10, 100);
    expect(w.low).toBeLessThan(0.1);
    expect(w.high).toBeGreaterThan(0.1);
    expect(w.low).toBeGreaterThanOrEqual(0);
    expect(w.high).toBeLessThanOrEqual(1);
  });
  it("widens when there is less data", () => {
    const a = wilson(10, 100);
    const b = wilson(100, 1000);
    expect(a.high - a.low).toBeGreaterThan(b.high - b.low);
  });
  it("handles zero successes without going negative", () => {
    const w = wilson(0, 50);
    expect(w.low).toBe(0);
    expect(w.high).toBeGreaterThan(0);
  });
});

describe("estimateFunnel", () => {
  it("says not enough data when the history is thin, and shows no numbers", () => {
    const r = estimateFunnel({ history: [row(12, 5, 2, 5000)], plannedBudgetInr: 10000 });
    expect(r.status).toBe("not_enough_data");
    expect(r).not.toHaveProperty("rates");
    expect(r.status === "not_enough_data" && r.reason).toMatch(/30/);
  });
  it("says not enough data for no history at all", () => {
    expect(estimateFunnel({ history: [], plannedBudgetInr: null }).status).toBe("not_enough_data");
  });
  it("returns rate ranges from pooled history, and leads from budget history when two plans have budgets", () => {
    const r = estimateFunnel({ history: [row(100, 30, 8, 10000), row(150, 40, 12, 20000)], plannedBudgetInr: 30000 });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.observed).toEqual({ leads: 250, kyc: 70, funded: 20 });
    expect(r.rates.kyc.low).toBeLessThan(70 / 250);
    expect(r.rates.kyc.high).toBeGreaterThan(70 / 250);
    expect(r.leads).toEqual({ low: 225, high: 300 });
    expect(r.kyc && r.kyc.low).toBeLessThan(r.kyc ? r.kyc.high : 0);
    expect(r.funded && r.funded.high).toBeLessThanOrEqual(300);
    expect(r.assumptions.length).toBeGreaterThanOrEqual(3);
  });
  it("gives rates but no counts when there is no budget history or no planned budget", () => {
    const a = estimateFunnel({ history: [row(100, 30, 8), row(150, 40, 12)], plannedBudgetInr: 30000 });
    expect(a.status === "ok" && a.leads).toBeNull();
    expect(a.status === "ok" && a.kyc).toBeNull();
    expect(a.status === "ok" && a.notes.join(" ")).toMatch(/budget/i);
    const b = estimateFunnel({ history: [row(100, 30, 8, 10000), row(150, 40, 12, 20000)], plannedBudgetInr: null });
    expect(b.status === "ok" && b.leads).toBeNull();
  });
  it("lets a person enter an expected lead count and uses it instead of inventing one", () => {
    const r = estimateFunnel({ history: [row(100, 30, 8), row(150, 40, 12)], plannedBudgetInr: null, expectedLeads: 200 });
    expect(r.status === "ok" && r.leads).toEqual({ low: 200, high: 200 });
    expect(r.status === "ok" && r.funded).not.toBeNull();
  });
  it("never reports more KYC than leads or more funded than KYC", () => {
    const r = estimateFunnel({ history: [row(40, 40, 40, 1000), row(40, 40, 40, 2000)], plannedBudgetInr: 1500 });
    if (r.status !== "ok" || !r.kyc || !r.funded || !r.leads) throw new Error("expected counts");
    expect(r.kyc.high).toBeLessThanOrEqual(r.leads.high);
    expect(r.funded.high).toBeLessThanOrEqual(r.kyc.high);
  });
});
