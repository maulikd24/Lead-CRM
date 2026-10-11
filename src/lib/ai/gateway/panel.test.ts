import { describe, expect, it } from "vitest";

import { buildAiPanel, type AiPanelRaw } from "./panel";

const NOW = new Date("2026-10-12T10:00:00Z");
const row = (purposeId: string, agentKey: string | null, status: "OK" | "ABSTAINED" | "FAILED" | "BLOCKED", runs: number, over: Partial<AiPanelRaw["window"][number]> = {}): AiPanelRaw["window"][number] =>
  ({ purposeId, agentKey, status, runs, inputTokens: runs * 100, outputTokens: runs * 20, costUsd: runs * 0.01, p50Ms: 300, p95Ms: 900, ...over });

const raw = (over: Partial<AiPanelRaw> = {}): AiPanelRaw => ({
  now: NOW, windowDays: 7,
  window: [row("nudger.draft", "wa_nudger", "OK", 90), row("nudger.draft", "wa_nudger", "ABSTAINED", 6), row("nudger.draft", "wa_nudger", "FAILED", 3), row("nudger.draft", "wa_nudger", "BLOCKED", 1), row("summary.page", "ai_summaries", "OK", 20)],
  today: [{ purposeId: "nudger.draft", costUsd: 4 }, { purposeId: "summary.page", costUsd: 0.2 }],
  settings: [{ agentKey: "wa_nudger", enabled: true }],
  autonomy: [{ agentKey: "wa_nudger", actionType: "draft_customer_message", level: 4 }],
  env: { AGENT_NUDGER_ENABLED: "1", AI_PURPOSE_BUDGETS_USD: "nudger.draft=5", AI_BUDGET_DEFAULT_USD: "" },
  oldestRun: new Date("2026-08-01T00:00:00Z"),
  ...over,
});

describe("buildAiPanel", () => {
  const p = buildAiPanel(raw());
  it("summarises runs, rates, tokens, cost and p95 over the window", () => {
    expect(p.summary).toMatchObject({ runs: 120, ok: 110, abstained: 6, failed: 3, blocked: 1 });
    expect(p.summary.failureRate).toBeCloseTo(3 / 120, 6);
    expect(p.summary.abstainRate).toBeCloseTo(6 / 120, 6);
    expect(p.summary.costWindowUsd).toBeCloseTo(1.2, 6);
    expect(p.summary.costTodayUsd).toBeCloseTo(4.2, 6);
    expect(p.summary.p95Ms).toBe(900);
  });
  it("lists every registered purpose, even with no runs, with its budget and state", () => {
    const nudger = p.purposes.find((x) => x.id === "nudger.draft")!;
    expect(nudger).toMatchObject({ runs: 100, abstained: 6, failed: 3, blocked: 1, budgetUsd: 5, costTodayUsd: 4, budgetState: "near" });
    expect(nudger.budgetPct).toBeCloseTo(80, 6);
    expect(p.purposes.find((x) => x.id === "ask.intelligence")).toMatchObject({ runs: 0, budgetState: "unset", budgetUsd: null });
    expect(p.purposes.length).toBeGreaterThanOrEqual(8);
  });
  it("flags a purpose that has used its budget, and one with no budget set", () => {
    const over = buildAiPanel(raw({ today: [{ purposeId: "nudger.draft", costUsd: 5.5 }] })).purposes.find((x) => x.id === "nudger.draft")!;
    expect(over.budgetState).toBe("over");
    const def = buildAiPanel(raw({ env: { AI_BUDGET_DEFAULT_USD: "2" } })).purposes.find((x) => x.id === "ask.intelligence")!;
    expect(def).toMatchObject({ budgetUsd: 2, budgetState: "ok" });
  });
  it("rates are null, not NaN, when a purpose has no runs", () => {
    const x = p.purposes.find((y) => y.id === "social.draft")!;
    expect(x.failureRate).toBeNull();
    expect(x.abstainRate).toBeNull();
  });
  it("the registry shows each agent's real kill switch halves and its ladder with the effective level and ceiling", () => {
    const a = p.agents.find((x) => x.key === "wa_nudger")!;
    expect(a.killSwitch).toMatchObject({ kind: "flag_and_setting", envFlag: "AGENT_NUDGER_ENABLED", envOn: true, rowOn: true, running: true, toggleable: true });
    expect(a.actions[0]).toMatchObject({ actionType: "draft_customer_message", level: 4, defaultLevel: 3, maxLevel: 4, ceiling: 4 });
    expect(a.runs).toBe(100);
    const stopped = buildAiPanel(raw({ settings: [] })).agents.find((x) => x.key === "wa_nudger")!;
    expect(stopped.killSwitch).toMatchObject({ rowOn: false, running: false });
    const summ = p.agents.find((x) => x.key === "ai_summaries")!;
    expect(summ.killSwitch).toMatchObject({ kind: "global_only", toggleable: false });
  });
  it("a stored level above the ceiling is shown capped, never as stored", () => {
    const a = buildAiPanel(raw({ autonomy: [{ agentKey: "wa_nudger", actionType: "draft_customer_message", level: 5 }] })).agents.find((x) => x.key === "wa_nudger")!;
    expect(a.actions[0].level).toBe(4);
  });
  it("reports the global kill switch, retention and the oldest detail row", () => {
    expect(p.globalKill).toBe(false);
    expect(buildAiPanel(raw({ env: { AI_KILL_SWITCH: "1" } })).globalKill).toBe(true);
    expect(p.retention).toMatchObject({ days: 90 });
    expect(buildAiPanel(raw({ env: { AI_RUN_RETENTION_DAYS: "30" } })).retention.days).toBe(30);
  });
  it("carries no customer text or secret: names and counts only", () => {
    expect(JSON.stringify(p)).not.toMatch(/sk-|@|ABCDE/);
  });
});
