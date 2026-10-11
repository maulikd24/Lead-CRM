// Suppression rules: hard rules, evaluated BEFORE ranking, one function per rule. Pure.
// Consent and the WhatsApp window are channel questions and live in policy.ts; everything else the spec lists is here.
import { DAY_MS, ENGINE_CONFIG } from "./constants";
import type { GateContext } from "./gate-context";
import type { Candidate, DecisionOwner, ScoreInput, Suppression, SuppressionRule } from "./types";

export type SuppressionResult = {
  suppressions: Suppression[];
  penalties: ScoreInput[];
  /** A delay: the earliest moment the action makes sense. */
  notBefore: Date | null;
  ownerOverride?: DecisionOwner;
};

const CONTACT_ACTIONS = new Set(["Call", "WhatsApp", "Email"]);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "an earlier date");

type Hit = { rule: SuppressionRule; effect: Suppression["effect"]; because: string; until?: Date | null; penalty?: ScoreInput; ownerOverride?: DecisionOwner };
type Rule = (c: Candidate, g: GateContext) => Hit[];

const openComplaint: Rule = (c, g) => {
  if (c.serviceRecovery) return [];
  const recent = g.complaint.lastAt && g.now.getTime() - g.complaint.lastAt.getTime() <= ENGINE_CONFIG.complaintWindowDays * DAY_MS;
  if (!g.complaint.open && !recent) return [];
  const why = g.complaint.because ?? (g.complaint.open ? "An open complaint" : `A complaint on ${day(g.complaint.lastAt)}`);
  return [{ rule: "open_complaint", effect: "block", because: `${why}: only service recovery is recommended until it is resolved`, until: null }];
};

const declinedClass: Rule = (c, g) => {
  if (!c.assetClass) return [];
  const hit = g.declined.find((d) => d.assetClass === c.assetClass);
  return hit ? [{ rule: "declined_class", effect: "block", because: hit.because }] : [];
};

const rmLow: Rule = (c, g) => {
  if (!c.assetClass) return [];
  const hit = g.rmLow.find((d) => d.assetClass === c.assetClass);
  return hit ? [{ rule: "rm_low_acceptance", effect: "block", because: hit.because }] : [];
};

const recentContact: Rule = (c, g) => {
  if (c.serviceRecovery || !g.lastContactAt) return [];
  const until = new Date(g.lastContactAt.getTime() + ENGINE_CONFIG.recentContactHours * 3600 * 1000);
  if (until.getTime() <= g.now.getTime()) return [];
  return [
    {
      rule: "recent_contact",
      effect: "delay",
      until,
      because: `Contacted on ${day(g.lastContactAt)}: wait until ${until.toISOString().slice(0, 16).replace("T", " ")} UTC`,
      penalty: { label: "Contacted within 48 hours", points: -ENGINE_CONFIG.recentContactPenalty, kind: "penalty" },
    },
  ];
};

const dismissed: Rule = (c, g) => {
  const out: Hit[] = [];
  for (const d of g.dismissals) {
    if (d.snoozeUntil.getTime() <= g.now.getTime()) continue;
    const exact = d.ruleKey === c.ruleKey && d.fingerprint === c.fingerprint;
    const dnr = d.ruleKey === "nba.dnr" && (d.fingerprint === `dnr:${c.assetClass ?? ""}` || d.fingerprint === `dnr:${c.programme}`);
    if (exact || dnr) out.push({ rule: "dismissed_or_snoozed", effect: "block", until: d.snoozeUntil, because: dnr ? `Marked do not recommend${d.reason ? ` (${d.reason})` : ""} until ${day(d.snoozeUntil)}` : `Dismissed or snoozed until ${day(d.snoozeUntil)}` });
  }
  return out.slice(0, 1);
};

const unreachable: Rule = (c, g) => (g.unreachableAttempts >= ENGINE_CONFIG.unreachableAttempts && CONTACT_ACTIONS.has(c.action) ? [{ rule: "unreachable", effect: "block", because: `Could not reach the customer ${g.unreachableAttempts} times: verify contact details first` }] : []);

const kycException: Rule = (c, g) => {
  if (!g.kycException.open) return [];
  if (c.ruleKey === "stage_gate.resolve_kyc_issue" || c.ruleKey === "exception.resolve" || c.serviceRecovery) return [];
  return [{ rule: "kyc_exception", effect: "block", because: `${g.kycException.label ?? "An open exception"}: resolve it before anything else` }];
};

const agentDisabled: Rule = (c, g) => (c.owner === "AI Bot" && !g.agentEnabled ? [{ rule: "agent_disabled", effect: "downrank", because: "The AI agent is not enabled, so a person owns this step", ownerOverride: "CRM" }] : []);

const productStance: Rule = (c, g) => {
  if (!c.assetClass) return [];
  const now = g.now.getTime();
  const hit = g.productStances.find((s) => s.assetClass === c.assetClass && s.stance !== "interested" && (!s.until || s.until.getTime() > now));
  if (!hit) return [];
  if (hit.confirmed && hit.stance === "not_interested") return [{ rule: "product_stance", effect: "block", because: hit.because }];
  // AI-inferred (or only an objection): can downrank or prompt a question, never stop on its own and never trigger.
  return [{ rule: "product_stance", effect: "downrank", because: `${hit.because} (unconfirmed)`, penalty: { label: "Unconfirmed product stance", points: -ENGINE_CONFIG.inferredPenalty, kind: "penalty" } }];
};

const productRegistry: Rule = (c, g) => {
  const hit = g.registryBlocks.find((b) => (b.assetClass !== null && b.assetClass === c.assetClass) || (b.programme !== null && b.programme === c.programme));
  return hit ? [{ rule: "product_registry", effect: "block", because: hit.reason }] : [];
};

const dataStale: Rule = (c, g) => {
  if (!c.asOf) return [{ rule: "data_stale", effect: "downrank", because: "No as-of date on the data behind this", penalty: { label: "Data age unknown", points: -ENGINE_CONFIG.staleSoftPenalty, kind: "penalty" } }];
  const ageDays = (g.now.getTime() - c.asOf.getTime()) / DAY_MS;
  if (ageDays > c.freshness.hardDays) return [{ rule: "data_stale", effect: "block", because: `The data behind this is ${Math.floor(ageDays)} days old (limit ${c.freshness.hardDays}): refresh it first` }];
  if (ageDays > c.freshness.softDays) return [{ rule: "data_stale", effect: "downrank", because: `The data behind this is ${Math.floor(ageDays)} days old`, penalty: { label: "Stale data", points: -ENGINE_CONFIG.staleSoftPenalty, kind: "penalty" } }];
  return [];
};

export const SUPPRESSION_TABLE: readonly Rule[] = [openComplaint, declinedClass, rmLow, recentContact, dismissed, unreachable, kycException, agentDisabled, productStance, productRegistry, dataStale];

export function evaluateSuppression(candidate: Candidate, ctx: GateContext): SuppressionResult {
  const hits = SUPPRESSION_TABLE.flatMap((rule) => rule(candidate, ctx));
  const delays = hits.filter((h) => h.effect === "delay" && h.until).map((h) => h.until as Date);
  const override = hits.find((h) => h.ownerOverride)?.ownerOverride;
  return {
    suppressions: hits.map((h) => ({ rule: h.rule, effect: h.effect, until: iso(h.until ?? null), because: h.because, candidateId: candidate.id })),
    penalties: hits.flatMap((h) => (h.penalty ? [h.penalty] : [])),
    notBefore: delays.length ? new Date(Math.max(...delays.map((d) => d.getTime()))) : null,
    ...(override ? { ownerOverride: override } : {}),
  };
}
