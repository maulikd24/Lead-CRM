import { emptyGateContext, type GateContext } from "@/lib/intelligence/decision/gate-context";
import { decide } from "@/lib/intelligence/decision/engine";
import { FRESHNESS } from "@/lib/intelligence/decision/constants";
import type { Candidate } from "@/lib/intelligence/decision/types";
import type { ConsentRow } from "@/lib/consent/decision";
import type { AssetClass } from "@/lib/intelligence/constants";
import type { CaseResult, Decision, DecisionScenario, EvalCase } from "./types";

const NOW = new Date("2026-10-09T10:00:00Z");
const H = 3_600_000;
const D = 24 * H;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const base = (over: Partial<Candidate>): Candidate => ({
  id: "t", source: "intelligence_nba", programme: "Service / relationship follow-up", action: "Call", topic: null, assetClass: null, reason: "A step to take.", priority: "Medium", owner: "RM", channel: "call", timing: "This Week",
  sales: false, serviceRecovery: false, bonuses: [], evidence: [{ kind: "fact", ref: "f", text: "A fact", observedAt: NOW.toISOString(), confirmation: "confirmed" }], asOf: NOW, freshness: { ...FRESHNESS.rule }, inferredOnly: false, ruleKey: "t", fingerprint: "t", productRefs: [], legacyChosen: false, ...over,
});

const TARGETS: Record<DecisionScenario["target"], Candidate> = {
  pms_call: base({ id: "pms_call", programme: "PMS / AIF opportunity", topic: "PMS", assetClass: "PMS", sales: true, ruleKey: "intelligence_nba.pms", fingerprint: "PMS", reason: "PMS acceptance is high for this HNI customer." }),
  mf_whatsapp: base({ id: "mf_whatsapp", programme: "MF / SIP opportunity", action: "WhatsApp", channel: "whatsapp", topic: "Start a SIP", assetClass: "Mutual Funds", sales: true, owner: "CRM", ruleKey: "intelligence_nba.mf", fingerprint: "SIP", reason: "Open to mutual funds and no SIP yet." }),
  kyc_whatsapp: base({ id: "kyc_whatsapp", programme: "Complete KYC", action: "WhatsApp", channel: "whatsapp", topic: "Upload documents", owner: "CRM", ruleKey: "stage_gate.collect_documents", fingerprint: "docs", reason: "Two documents are still pending." }),
  service_call: base({ id: "service_call", programme: "Service / relationship follow-up", topic: "Resolve the open issue", serviceRecovery: true, owner: "Support", priority: "High", ruleKey: "intelligence_nba.service", fingerprint: "svc", reason: "Resolve the open issue first." }),
  task_followup: base({ id: "task_followup", action: "Task", channel: "none", topic: "Send the form", serviceRecovery: true, ruleKey: "stage_next_action", fingerprint: "form", reason: "Open task: send the form." }),
  ai_kyc_draft: base({ id: "ai_kyc_draft", programme: "Complete KYC", action: "WhatsApp", channel: "whatsapp", topic: "KYC reminder", owner: "AI Bot", ruleKey: "agent_proposal", fingerprint: "p1", reason: "KYC reminder draft." }),
};

function context(s: DecisionScenario): { gate: GateContext; target: Candidate } {
  const c = s.ctx ?? {};
  const g = emptyGateContext("eval", NOW);
  const rows: ConsentRow[] = [];
  const marketing = c.marketing ?? "granted";
  if (marketing !== "none") rows.push({ purpose: "MARKETING_COMMS", channel: null, status: "GRANTED", capturedAt: ago(40 * D) });
  if (marketing === "withdrawn_whatsapp") rows.push({ purpose: "MARKETING_COMMS", channel: "whatsapp", status: "WITHDRAWN", capturedAt: ago(3 * D) });
  if (c.dnd) rows.push({ purpose: "DO_NOT_CONTACT", channel: null, status: "GRANTED", capturedAt: ago(2 * D) });
  g.consent = { rows, legacyMarketingConsentAt: null };
  if (c.complaintOpen) g.complaint = { open: true, lastAt: ago(1 * D), because: "Open complaint" };
  else if (c.complaintDaysAgo !== undefined) g.complaint = { open: false, lastAt: ago(c.complaintDaysAgo * D), because: "A complaint was raised" };
  if (c.declined) g.declined = [{ assetClass: c.declined as AssetClass, because: `Declined ${c.declined} recently` }];
  if (c.rmLow) g.rmLow = [{ assetClass: c.rmLow as AssetClass, because: `RM marked ${c.rmLow} Low` }];
  if (c.contactHoursAgo !== undefined) g.lastContactAt = ago(c.contactHoursAgo * H);
  g.lastInboundWhatsAppAt = c.whatsappInboundHoursAgo === undefined ? ago(2 * H) : c.whatsappInboundHoursAgo === null ? null : ago(c.whatsappInboundHoursAgo * H);
  g.approvedTemplateExists = c.template ?? false;
  g.complianceConcernOpen = !!c.compliance;
  g.unreachableAttempts = c.unreachable ?? 0;
  if (c.exception) g.kycException = { open: true, label: "KYC rejected" };
  if (c.dismissed) g.dismissals = [{ ruleKey: TARGETS[s.target].ruleKey, fingerprint: TARGETS[s.target].fingerprint, snoozeUntil: c.dismissed === "active" ? new Date(NOW.getTime() + 3 * D) : ago(1 * D), reason: null }];
  if (c.dnr) g.dismissals = [...g.dismissals, { ruleKey: "nba.dnr", fingerprint: `dnr:${TARGETS[s.target].assetClass ?? TARGETS[s.target].programme}`, snoozeUntil: new Date(NOW.getTime() + 100 * D), reason: "customer_asked" }];
  if (c.conflict) g.evidenceConflicts = [{ assetClass: TARGETS[s.target].assetClass, because: "Interest and a decline are both open" }];
  g.agentEnabled = !c.agentOff;
  let target = TARGETS[s.target];
  if (c.stale === "soft") target = { ...target, asOf: ago(20 * D), freshness: { softDays: 14, hardDays: 60 } };
  if (c.stale === "hard") target = { ...target, asOf: ago(90 * D), freshness: { softDays: 14, hardDays: 60 } };
  if (c.inferredOnly) target = { ...target, inferredOnly: true, evidence: [{ kind: "memory", ref: "i", text: "AI reading", observedAt: null, confirmation: "ai_inferred" }] };
  return { gate: g, target };
}

export function evaluateDecision(c: Extract<EvalCase, { kind: "decision" }>): CaseResult {
  const { gate, target } = context(c.scenario);
  const d = decide({ ctx: gate, candidates: [target] });
  const untouched = d.result === "RECOMMEND" && d.chosenCandidateId === target.id && d.channel === target.channel && d.action === target.action && d.owner === target.owner && d.notBefore === null;
  const actual: Decision = untouched ? "allow" : "block";
  const detail = d.result === "RECOMMEND" ? `${d.action} via ${d.channel}, owner ${d.owner}${d.notBefore ? `, not before ${d.notBefore.slice(0, 10)}` : ""}` : `${d.result}${d.abstainReason ? ` (${d.abstainReason})` : ""}: ${d.reason.slice(0, 80)}`;
  return { case: c, actual, detail };
}
