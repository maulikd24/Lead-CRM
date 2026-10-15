import { ratio, sum } from "./stats";
import { isAppliable, type ActionKind, type Recommendation } from "./recommendations";
import type { AutopilotSnapshot } from "./types";

/**
 * Rules: "if cost per funded customer is above X over the last N days, propose a pause". A rule only ever PROPOSES:
 * its output is a recommendation a person must approve. Every metric has a minimum sample, below which the rule
 * stays silent and says so, rather than firing on noise.
 */

export const RULE_METRICS = {
  cost_per_funded: { label: "Cost per funded customer", unit: "inr", minLeads: 20 },
  cost_per_lead: { label: "Cost per lead", unit: "inr", minLeads: 20 },
  click_through_rate: { label: "Click-through rate", unit: "ratio", minLeads: 0 },
  contacted_in_sla: { label: "Leads contacted within the promise", unit: "ratio", minLeads: 20 },
  spend: { label: "Spend", unit: "inr", minLeads: 0 },
} as const;
export type RuleMetric = keyof typeof RULE_METRICS;

export type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  metric: RuleMetric;
  op: ">" | "<";
  threshold: number;
  /** Look-back window in days ending at the newest data. 1..90. */
  days: number;
  /** Campaign ids, or null for every campaign. */
  campaignIds: string[] | null;
  /** Ad accounts the rule is limited to, or null for every account (a firm may run several). A campaign must pass BOTH limits. */
  accountIds: string[] | null;
  action: ActionKind;
};

export type RuleOutcome = { ruleId: string; campaignId: string; fired: boolean; held?: string; value: number | null };

export type RuleRun = { proposals: Recommendation[]; outcomes: RuleOutcome[] };

export function validateRule(r: Partial<Rule>): string | null {
  if (!r.name || r.name.trim().length < 2) return "Give the rule a name.";
  if (!r.metric || !(r.metric in RULE_METRICS)) return "Pick a measure.";
  if (r.op !== ">" && r.op !== "<") return "Pick above or below.";
  if (typeof r.threshold !== "number" || !Number.isFinite(r.threshold) || r.threshold < 0) return "Enter a number for the limit.";
  if (!Number.isInteger(r.days) || (r.days as number) < 1 || (r.days as number) > 90) return "Days must be between 1 and 90.";
  if (!r.action) return "Pick what to propose.";
  return null;
}

export function runRules(s: AutopilotSnapshot, rules: Rule[]): RuleRun {
  const proposals: Recommendation[] = [];
  const outcomes: RuleOutcome[] = [];
  const until = Date.parse(s.window.until);
  for (const rule of rules.filter((r) => r.enabled && !validateRule(r))) {
    const from = new Date(until - (rule.days - 1) * 86_400_000).toISOString().slice(0, 10);
    for (const c of s.campaigns.filter((c) => (!rule.campaignIds || rule.campaignIds.includes(c.id)) && (!rule.accountIds || (c.accountId !== undefined && rule.accountIds.includes(c.accountId))))) {
      const rows = s.days.filter((d) => d.campaignId === c.id && d.date >= from && d.date <= s.window.until);
      // What came of the clicks over this rule's window is the provider's number for that window, never worked out here.
      const out = s.windowOutcomes[String(rule.days)]?.[c.id];
      const leadCount = out?.leads ?? 0;
      const spend = sum(rows.map((r) => r.spend));
      let value: number | null = null;
      switch (rule.metric) {
        case "cost_per_funded": value = out?.costPerFunded ?? null; break;
        case "cost_per_lead": value = out?.costPerLead ?? null; break;
        case "click_through_rate": value = ratio(sum(rows.map((r) => r.clicks)), sum(rows.map((r) => r.impressions))); break;
        case "contacted_in_sla": value = out?.contactedInSlaRate ?? null; break;
        case "spend": value = rows.length ? spend : null; break;
      }
      const need = RULE_METRICS[rule.metric].minLeads;
      const sample = leadCount;
      // "Cost per funded" with zero funded customers has no value; judge it only when the leads sample is big enough.
      if (rule.metric === "cost_per_funded" && value === null && leadCount >= need && (out?.spend ?? 0) > 0 && out?.funded === 0) value = Infinity;
      if (value === null || (need > 0 && sample < need)) { outcomes.push({ ruleId: rule.id, campaignId: c.id, fired: false, held: need > 0 && sample < need ? `Only ${sample} leads in ${rule.days} days (needs ${need})` : "No data", value: null }); continue; }
      const fired = rule.op === ">" ? value > rule.threshold : value < rule.threshold;
      outcomes.push({ ruleId: rule.id, campaignId: c.id, fired, value: Number.isFinite(value) ? value : null });
      if (!fired) continue;
      const shown = Number.isFinite(value) ? value.toFixed(RULE_METRICS[rule.metric].unit === "ratio" ? 3 : 0) : "no funded customer";
      proposals.push({
        id: `RULE_${rule.id}:${c.id}`, ruleKey: `RULE_${rule.id}`, category: "Bidding", severity: "medium",
        issue: `Rule "${rule.name}": ${RULE_METRICS[rule.metric].label.toLowerCase()} for ${c.name} is ${shown} over the last ${rule.days} days (limit ${rule.op} ${rule.threshold}).`,
        evidence: [`${rule.days}-day window ending ${s.window.until}`, `spend ${Math.round(spend)}`, `${leadCount} CRM leads`],
        action: { kind: rule.action, targetIds: [c.id], summary: `Proposed by your rule "${rule.name}"`, params: { ruleId: rule.id } },
        impact: { amount: null, text: "" }, confidence: "medium", appliable: isAppliable(rule.action), status: "PENDING",
      });
    }
  }
  return { proposals, outcomes };
}

// ---- Previewing a rule before it is saved ---------------------------------------------------------------------------------------------------

export type RulePreviewRow = { campaignId: string; campaignName: string; value: number | null; reason: string };
export type RulePreview = {
  window: { from: string; to: string };
  /** Campaigns the rule would propose an action for, as of today's data. */
  wouldPropose: RulePreviewRow[];
  /** Campaigns the rule stays silent on because there is too little behind the measure (or no data). */
  held: RulePreviewRow[];
  /** Campaigns that were judged and did not cross the limit. */
  quiet: RulePreviewRow[];
  error?: string;
  asOf: string;
};

/** Runs a (possibly disabled, unsaved) rule against today's snapshot and reports what it WOULD do. Pure; it proposes nothing and touches nothing. */
export function previewRule(s: AutopilotSnapshot, rule: Omit<Rule, "id"> & { id?: string }): RulePreview {
  const to = s.window.until;
  const from = Number.isInteger(rule.days) && rule.days >= 1 ? new Date(Date.parse(to) - (rule.days - 1) * 86_400_000).toISOString().slice(0, 10) : to;
  const base = { window: { from, to }, wouldPropose: [], held: [], quiet: [], asOf: s.asOf };
  const err = validateRule(rule);
  if (err) return { ...base, error: err };
  const run = runRules(s, [{ ...rule, id: "preview", enabled: true }]);
  const name = (id: string) => s.campaigns.find((c) => c.id === id)?.name ?? id;
  const row = (o: RuleOutcome, reason: string): RulePreviewRow => ({ campaignId: o.campaignId, campaignName: name(o.campaignId), value: o.value, reason });
  return {
    ...base,
    wouldPropose: run.outcomes.filter((o) => o.fired).map((o) => row(o, `${RULE_METRICS[rule.metric].label} is ${o.value === null ? "beyond any funded customer" : Math.round(o.value * 1000) / 1000}, past your limit of ${rule.threshold}.`)),
    held: run.outcomes.filter((o) => !o.fired && o.held).map((o) => row(o, o.held as string)),
    quiet: run.outcomes.filter((o) => !o.fired && !o.held).map((o) => row(o, `${RULE_METRICS[rule.metric].label} is ${o.value === null ? "n/a" : Math.round(o.value * 1000) / 1000}, within your limit.`)),
  };
}

/**
 * SEAM for the generic simulate() primitive (Addendum 1: one primitive that says who is eligible, who is suppressed and why, who gets which channel, and
 * the AI calls and cost, used first by rules and bulk actions). It is on the Wave 2 branches and NOT on this base, so nothing here imports it. When it lands,
 * a rule preview becomes one call: `simulate({ kind: "rule.preview", ... })` returning exactly the shape asSimulation() builds, and previewRule stays as the
 * pure evaluator behind it. Until then the Rules tab shows previewRule's own result. Documented in docs/autopilot.md.
 */
export const SIMULATE_SEAM = { primitive: "simulate", onThisBase: false, wave: "2", adapter: "asSimulation" } as const;

export type SimulationShape = {
  kind: "rule.preview";
  mode: "dry_run";
  eligible: { id: string; label: string; detail: string }[];
  suppressed: { id: string; label: string; reason: string }[];
  /** A preview changes nothing: no ad account, no customer, no model call. */
  effects: { adAccountChanged: false; customerContacted: false; aiCalls: 0; costUsd: 0 };
};

export function asSimulation(p: RulePreview): SimulationShape {
  return {
    kind: "rule.preview", mode: "dry_run",
    eligible: p.wouldPropose.map((r) => ({ id: r.campaignId, label: r.campaignName, detail: r.reason })),
    suppressed: [...p.held, ...p.quiet].map((r) => ({ id: r.campaignId, label: r.campaignName, reason: r.reason })),
    effects: { adAccountChanged: false, customerContacted: false, aiCalls: 0, costUsd: 0 },
  };
}
