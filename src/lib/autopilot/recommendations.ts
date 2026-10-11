import { nameOf } from "./derive";
import { SEVERITY_WEIGHT } from "./scoring";
import { inr } from "./stats";
import { timingReport } from "./timing";
import { DEFAULT_THRESHOLDS, type Thresholds } from "./thresholds";
import { wastedSpend } from "./waste";
import type { AutopilotSnapshot, Category, ControlResult, Severity } from "./types";

/**
 * Issue > action rows. Each is a PROPOSAL with its evidence: nothing here touches an ad account. A person approves
 * or denies each one; a denial must carry a reason, and those reasons feed back into which proposals are shown again.
 */

/** Kinds a platform adapter may apply. Everything else is a task for a person. */
export const APPLIABLE_KINDS = ["pause_campaign", "reduce_budget", "add_negative_keywords", "exclude_placement", "adjust_schedule"] as const;
export type AppliableKind = (typeof APPLIABLE_KINDS)[number];
export type ActionKind = AppliableKind | "fix_tracking" | "staff_shift" | "refresh_creative" | "review_manually";

export type RecommendationStatus = "PENDING" | "APPROVED" | "DENIED" | "APPLIED" | "FAILED" | "UNDONE";

export type Recommendation = {
  /** Stable across runs: the same issue on the same target keeps the same id, so decisions stick. */
  id: string;
  ruleKey: string;
  category: Category;
  severity: Severity;
  issue: string;
  evidence: string[];
  action: { kind: ActionKind; targetIds: string[]; summary: string; params: Record<string, unknown> };
  /** What could be saved or recovered, as a plain figure, or null when it cannot be estimated honestly. */
  impact: { amount: number | null; text: string };
  confidence: "high" | "medium" | "low";
  appliable: boolean;
  status: RecommendationStatus;
};

export const isAppliable = (k: ActionKind): k is AppliableKind => (APPLIABLE_KINDS as readonly string[]).includes(k);

const idOf = (ruleKey: string, targets: string[]) => `${ruleKey}:${[...targets].sort().join(",") || "account"}`;

function make(partial: Omit<Recommendation, "id" | "appliable" | "status">): Recommendation {
  return { ...partial, id: idOf(partial.ruleKey, partial.action.targetIds), appliable: isAppliable(partial.action.kind), status: "PENDING" };
}

/** Turn failed controls and the other reports into proposals, most important first. */
export function buildRecommendations(s: AutopilotSnapshot, results: ControlResult[], t: Thresholds = DEFAULT_THRESHOLDS): Recommendation[] {
  const recs: Recommendation[] = [];
  const waste = wastedSpend(s, t);
  const wasteOf = (k: string) => waste.causes.find((c) => c.key === k);
  const fails = results.filter((r) => r.state === "fail");
  for (const r of fails) {
    const base = { ruleKey: r.id, category: r.category, severity: r.severity, issue: r.finding, evidence: r.evidence };
    const ids = r.campaignIds ?? [];
    switch (r.id) {
      case "BD1": recs.push(make({ ...base, action: { kind: "pause_campaign", targetIds: ids, summary: `Pause ${ids.map((i) => nameOf(s, i)).slice(0, 2).join(" and ")} until cost per funded customer is back under target`, params: {} }, impact: { amount: null, text: "Stops spend above target; the saving depends on how the campaign would have performed." }, confidence: "medium" })); break;
      case "BP1": recs.push(make({ ...base, action: { kind: "reduce_budget", targetIds: ids, summary: "Review daily budgets so the month lands on plan", params: { to: "plan" } }, impact: { amount: null, text: "Brings month-end spend back to plan." }, confidence: "medium" })); break;
      case "BP3": recs.push(make({ ...base, action: { kind: "review_manually", targetIds: ids, summary: "Find out why active campaigns are not spending (payment, review status, audience size)", params: {} }, impact: { amount: null, text: "Restores reach." }, confidence: "high" })); break;
      case "NG1": { const w = wasteOf("irrelevant_terms"); recs.push(make({ ...base, action: { kind: "add_negative_keywords", targetIds: ids, summary: "Add the irrelevant search terms as negative keywords", params: { terms: w?.top ?? [] } }, impact: { amount: w?.amount ?? null, text: w ? `Up to ${inr(w.amount)} in this period` : "" }, confidence: "high" })); break; }
      case "PL1": { const w = wasteOf("junk_placements"); recs.push(make({ ...base, action: { kind: "exclude_placement", targetIds: ids, summary: "Exclude the placements that bring no leads", params: { placements: w?.top ?? [] } }, impact: { amount: w?.amount ?? null, text: w ? `Up to ${inr(w.amount)} in this period` : "" }, confidence: "high" })); break; }
      case "SC1": { const w = wasteOf("zero_lead_hours"); recs.push(make({ ...base, action: { kind: "adjust_schedule", targetIds: ids, summary: "Turn off the hours of the week that bring no conversions", params: { hours: w?.top ?? [] } }, impact: { amount: w?.amount ?? null, text: w ? `Up to ${inr(w.amount)} in this period` : "" }, confidence: "medium" })); break; }
      case "CT1": case "CT2": case "CT3": recs.push(make({ ...base, action: { kind: "fix_tracking", targetIds: [], summary: "Fix the conversion tracking before changing anything else; every optimisation depends on it", params: {} }, impact: { amount: null, text: "Restores trustworthy numbers." }, confidence: "high" })); break;
      case "CR1": recs.push(make({ ...base, action: { kind: "refresh_creative", targetIds: ids, summary: "Brief new ad creative for the tired ads (drafts go through compliance review)", params: {} }, impact: { amount: null, text: "Recovers click-through." }, confidence: "medium" })); break;
      case "LP2": recs.push(make({ ...base, action: { kind: "staff_shift", targetIds: [], summary: "Route ad leads to the first available caller; review who covers peak arrival hours", params: {} }, impact: { amount: null, text: "Faster contact lifts the funded rate." }, confidence: "medium" })); break;
      default: if (SEVERITY_WEIGHT[r.severity] > 0) recs.push(make({ ...base, action: { kind: "review_manually", targetIds: ids, summary: "Review with the marketing owner", params: {} }, impact: { amount: null, text: "" }, confidence: "low" }));
    }
  }
  // Time-of-day proposals come from the timing report (only when its sample is big enough).
  for (const tr of timingReport(s, t).recommendations) {
    recs.push(make({ ruleKey: `TIME_${tr.kind}_${tr.band}`, category: "Schedule", severity: "medium", issue: tr.headline + ".", evidence: tr.evidence, action: { kind: tr.kind === "staff_band" ? "staff_shift" : "adjust_schedule", targetIds: [], summary: tr.headline, params: { band: tr.band } }, impact: { amount: null, text: "" }, confidence: "medium" }));
  }
  return recs.sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] || (b.impact.amount ?? 0) - (a.impact.amount ?? 0));
}

// --- Decisions --------------------------------------------------------------------------------------------------

export const DENY_REASONS = [
  { code: "not_relevant", label: "Not relevant to us" },
  { code: "already_handled", label: "Already handled" },
  { code: "threshold_too_strict", label: "The limit is too strict" },
  { code: "wrong_data", label: "The data looks wrong" },
  { code: "bad_timing", label: "Not the right time" },
  { code: "other", label: "Other (say why)" },
] as const;
export type DenyReason = (typeof DENY_REASONS)[number]["code"];

export type Decision = { recId: string; ruleKey: string; targetKey: string; decision: "APPROVED" | "DENIED"; reasonCode: DenyReason | null; note: string | null; actorId: string; at: string };

export type DecisionResult = { ok: true; decision: Decision } | { ok: false; error: string };

export function decide(rec: Recommendation, verdict: "approve" | "deny", actorId: string, input: { reasonCode?: string; note?: string } = {}, now: Date = new Date()): DecisionResult {
  if (rec.status !== "PENDING") return { ok: false, error: "This proposal has already been decided." };
  if (!actorId) return { ok: false, error: "A person must make the decision." };
  const base = { recId: rec.id, ruleKey: rec.ruleKey, targetKey: [...rec.action.targetIds].sort().join(",") || "account", actorId, at: now.toISOString() };
  if (verdict === "approve") return { ok: true, decision: { ...base, decision: "APPROVED", reasonCode: null, note: null } };
  const code = DENY_REASONS.find((r) => r.code === input.reasonCode)?.code;
  if (!code) return { ok: false, error: "Choose a reason for denying." };
  const note = (input.note ?? "").trim().slice(0, 500);
  if (code === "other" && note.length < 3) return { ok: false, error: "Say briefly why." };
  return { ok: true, decision: { ...base, decision: "DENIED", reasonCode: code, note: note || null } };
}

export type Tuning = {
  /** Proposals to hide for a while: the same rule on the same target was denied repeatedly. */
  suppressed: { ruleKey: string; targetKey: string; until: string; denials: number }[];
  /** Suggestions for a person to review. Nothing is changed automatically. */
  thresholdHints: { ruleKey: string; message: string; denials: number }[];
};

/** What denials teach us. Pure; the caller decides what to do with it. */
export function tuneFromDenials(history: Decision[], now: Date = new Date()): Tuning {
  const recent = history.filter((d) => d.decision === "DENIED" && now.getTime() - Date.parse(d.at) < 60 * 86_400_000);
  const by = new Map<string, Decision[]>();
  for (const d of recent) { const k = `${d.ruleKey}|${d.targetKey}`; by.set(k, [...(by.get(k) ?? []), d]); }
  const suppressed: Tuning["suppressed"] = [];
  for (const [k, ds] of by) {
    const quiet = ds.filter((d) => d.reasonCode === "not_relevant" || d.reasonCode === "already_handled" || d.reasonCode === "bad_timing");
    if (quiet.length >= 2) { const [ruleKey, targetKey] = k.split("|"); suppressed.push({ ruleKey, targetKey, denials: quiet.length, until: new Date(now.getTime() + 30 * 86_400_000).toISOString() }); }
  }
  const strict = new Map<string, number>();
  for (const d of recent) if (d.reasonCode === "threshold_too_strict") strict.set(d.ruleKey, (strict.get(d.ruleKey) ?? 0) + 1);
  const thresholdHints = [...strict].filter(([, n]) => n >= 3).map(([ruleKey, n]) => ({ ruleKey, denials: n, message: `${ruleKey} was denied ${n} times as too strict. Consider loosening its limit in Settings.` }));
  return { suppressed, thresholdHints };
}

export function withoutSuppressed(recs: Recommendation[], tuning: Tuning, now: Date = new Date()): Recommendation[] {
  return recs.filter((r) => !tuning.suppressed.some((s) => s.ruleKey === r.ruleKey && s.targetKey === ([...r.action.targetIds].sort().join(",") || "account") && Date.parse(s.until) > now.getTime()));
}
