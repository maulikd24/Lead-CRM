import { ACTION_TYPES, ceilingForAction, effectiveLevel, type AutonomyLevel } from "@/lib/agents/autonomy";
import { AGENTS } from "@/lib/agents/registry";

import { budgetFor, retentionDays } from "./gateway";
import { PURPOSES } from "./purposes";

/**
 * The view model behind the Admin AI tab: runs by agent and purpose, cost against budget, failure and abstain rates, latency, the
 * registry with autonomy levels and the kill switches. Counts, names and money only: no prompt, no output, no customer text.
 */
export type RawRow = { purposeId: string; agentKey: string | null; status: "OK" | "ABSTAINED" | "FAILED" | "BLOCKED"; runs: number; inputTokens: number; outputTokens: number; costUsd: number; p50Ms: number | null; p95Ms: number | null };
export type AiPanelRaw = {
  now: Date;
  windowDays: number;
  window: RawRow[];
  today: { purposeId: string; costUsd: number }[];
  settings: { agentKey: string; enabled: boolean }[];
  autonomy: { agentKey: string; actionType: string; level: number }[];
  env: Record<string, string | undefined>;
  oldestRun: Date | null;
};

export type BudgetState = "ok" | "near" | "over" | "unset";
type Counts = { runs: number; ok: number; abstained: number; failed: number; blocked: number };
const zero = (): Counts => ({ runs: 0, ok: 0, abstained: 0, failed: 0, blocked: 0 });
const rate = (n: number, d: number) => (d === 0 ? null : n / d);
function add(c: Counts, r: RawRow) {
  c.runs += r.runs;
  if (r.status === "OK") c.ok += r.runs; else if (r.status === "ABSTAINED") c.abstained += r.runs; else if (r.status === "FAILED") c.failed += r.runs; else c.blocked += r.runs;
}
/** The worst p95 across rows: a conservative single figure when the exact merged percentile is not available. */
const maxOf = (xs: (number | null)[]) => xs.reduce<number | null>((m, x) => (x === null ? m : m === null || x > m ? x : m), null);

export type PurposeRow = Counts & { id: string; label: string; agentKey: string | null; dataClass: string; failureRate: number | null; abstainRate: number | null; blockedRate: number | null; p50Ms: number | null; p95Ms: number | null; costWindowUsd: number; costTodayUsd: number; budgetUsd: number | null; budgetPct: number | null; budgetState: BudgetState };
export type KillSwitchView =
  | { kind: "flag_and_setting"; envFlag: string; envOn: boolean; rowOn: boolean; running: boolean; toggleable: true }
  | { kind: "global_only"; note: string; toggleable: false };
export type ActionRow = { actionType: string; label: string; actionClass: string; level: AutonomyLevel; defaultLevel: AutonomyLevel; maxLevel: AutonomyLevel; ceiling: AutonomyLevel };
export type AgentRow = { key: string; purpose: string; owner: string; approval: string; evalSuite: string | null; runs: number; failureRate: number | null; abstainRate: number | null; costWindowUsd: number; killSwitch: KillSwitchView; actions: ActionRow[]; purposes: string[]; fallback: string };

export type AiPanel = {
  windowDays: number;
  globalKill: boolean;
  summary: Counts & { failureRate: number | null; abstainRate: number | null; blockedRate: number | null; costWindowUsd: number; costTodayUsd: number; inputTokens: number; outputTokens: number; p95Ms: number | null };
  purposes: PurposeRow[];
  agents: AgentRow[];
  retention: { days: number; oldestRun: string | null };
  generatedAt: string;
};

export function buildAiPanel(raw: AiPanelRaw): AiPanel {
  const total = zero();
  let costWindow = 0, inTok = 0, outTok = 0;
  for (const r of raw.window) { add(total, r); costWindow += r.costUsd; inTok += r.inputTokens; outTok += r.outputTokens; }
  const todayBy = new Map<string, number>();
  for (const t of raw.today) todayBy.set(t.purposeId, (todayBy.get(t.purposeId) ?? 0) + t.costUsd);

  const purposes = PURPOSES.map((p): PurposeRow => {
    const rows = raw.window.filter((r) => r.purposeId === p.id);
    const c = zero();
    for (const r of rows) add(c, r);
    const budgetUsd = budgetFor(p.id, raw.env);
    const costToday = todayBy.get(p.id) ?? 0;
    const pct = budgetUsd === null ? null : budgetUsd === 0 ? 100 : (costToday / budgetUsd) * 100;
    const state: BudgetState = budgetUsd === null ? "unset" : pct !== null && pct >= 100 ? "over" : pct !== null && pct >= 75 ? "near" : "ok";
    return { id: p.id, label: p.label, agentKey: p.agentKey, dataClass: p.dataClass, ...c, failureRate: rate(c.failed, c.runs), abstainRate: rate(c.abstained, c.runs), blockedRate: rate(c.blocked, c.runs), p50Ms: maxOf(rows.map((r) => r.p50Ms)), p95Ms: maxOf(rows.map((r) => r.p95Ms)), costWindowUsd: rows.reduce((s, r) => s + r.costUsd, 0), costTodayUsd: costToday, budgetUsd, budgetPct: pct, budgetState: state };
  });

  const agents = AGENTS.map((a): AgentRow => {
    const rows = raw.window.filter((r) => r.agentKey === a.key);
    const c = zero();
    for (const r of rows) add(c, r);
    const setting = raw.settings.find((s) => s.agentKey === a.key);
    const killSwitch: KillSwitchView = a.killSwitch.kind === "flag_and_setting"
      ? { kind: "flag_and_setting", envFlag: a.killSwitch.envFlag, envOn: raw.env[a.killSwitch.envFlag] === "1", rowOn: setting?.enabled === true, running: raw.env[a.killSwitch.envFlag] === "1" && setting?.enabled === true, toggleable: true }
      : { kind: "global_only", note: a.killSwitch.note, toggleable: false };
    return {
      key: a.key, purpose: a.purpose, owner: a.owner, approval: a.approval.required === "always" ? `Always: ${a.approval.via}` : a.approval.required === "policy" ? `By policy: ${a.approval.via}` : `Not needed: ${a.approval.via}`,
      evalSuite: a.evalSuite?.ref ?? null, runs: c.runs, failureRate: rate(c.failed, c.runs), abstainRate: rate(c.abstained, c.runs), costWindowUsd: rows.reduce((s, r) => s + r.costUsd, 0), killSwitch, fallback: a.fallback, purposes: a.purposes,
      actions: a.actions.map((e): ActionRow => ({
        actionType: e.actionType, label: ACTION_TYPES[e.actionType].label, actionClass: ACTION_TYPES[e.actionType].class,
        level: effectiveLevel(e, e.actionType, raw.autonomy.find((x) => x.agentKey === a.key && x.actionType === e.actionType)?.level), defaultLevel: e.defaultLevel, maxLevel: e.maxLevel, ceiling: ceilingForAction(e.actionType),
      })),
    };
  });

  return {
    windowDays: raw.windowDays,
    globalKill: raw.env.AI_KILL_SWITCH === "1",
    summary: { ...total, failureRate: rate(total.failed, total.runs), abstainRate: rate(total.abstained, total.runs), blockedRate: rate(total.blocked, total.runs), costWindowUsd: costWindow, costTodayUsd: [...todayBy.values()].reduce((s, x) => s + x, 0), inputTokens: inTok, outputTokens: outTok, p95Ms: maxOf(raw.window.map((r) => r.p95Ms)) },
    purposes, agents,
    retention: { days: retentionDays(raw.env), oldestRun: raw.oldestRun ? raw.oldestRun.toISOString() : null },
    generatedAt: raw.now.toISOString(),
  };
}
