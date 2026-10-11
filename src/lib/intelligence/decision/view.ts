// Serializable view of a stored decision for screens (the Evidence Drawer, the shadow review list). No Prisma types, dates as ISO strings.
// Never includes raw conversation text, PAN or phone numbers: evidence lines are summaries written by the adapters.
import { CORRELATION_NOTE } from "./outcome-linking";
import type { Alternative, EvidenceItem, PolicyResult, ScoreInput, Suppression } from "./types";

export type DecisionView = {
  id: string;
  clientId: string;
  createdAt: string;
  observedAt: string;
  engineVersion: string;
  correlationId: string;
  mode: string;
  result: "RECOMMEND" | "NO_ACTION" | "ABSTAIN";
  abstainReason: string | null;
  escalation: string | null;
  action: string;
  programme: string;
  topic: string | null;
  assetClass: string | null;
  reason: string;
  priority: string;
  priorityScore: number;
  owner: string;
  channel: string;
  timing: string;
  notBefore: string | null;
  confidence: string;
  evidence: EvidenceItem[];
  scoreInputs: ScoreInput[];
  suppression: Suppression[];
  policyResult: PolicyResult;
  alternatives: Alternative[];
  status: string;
  feedback: { kind: string; reason: string | null; at: string }[];
  outcomes: { kind: string; daysAfter: number; detail: string | null }[];
  disagreement: { kind: string; severity: string; summary: string } | null;
  legacy: { programme: string; action: string; topic: string | null; owner: string } | null;
  correlationNote: string;
};

type Row = {
  id: string; clientId: string; createdAt: Date; observedAt: Date; engineVersion: string; correlationId: string; mode: string; result: string; abstainReason: string | null; escalation: string | null;
  action: string; programme: string; topic: string | null; assetClass: string | null; reason: string; priority: string; priorityScore: number; owner: string; channel: string; timing: string; notBefore: Date | null; confidence: string;
  evidence: unknown; scoreInputs: unknown; suppression: unknown; policyResult: unknown; alternatives: unknown; status: string; legacy: unknown;
  feedback?: { kind: string; reason: string | null; createdAt: Date; userId: string }[];
  outcomes?: { kind: string; daysAfter: number; detail: string | null }[];
  disagreement?: { kind: string; severity: string; summary: string } | null;
};

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function toDecisionView(r: Row): DecisionView {
  const legacy = r.legacy && typeof r.legacy === "object" ? (r.legacy as { programme?: string; action?: string; topic?: string | null; owner?: string }) : null;
  return {
    id: r.id,
    clientId: r.clientId,
    createdAt: r.createdAt.toISOString(),
    observedAt: r.observedAt.toISOString(),
    engineVersion: r.engineVersion,
    correlationId: r.correlationId,
    mode: r.mode,
    result: r.result as DecisionView["result"],
    abstainReason: r.abstainReason,
    escalation: r.escalation,
    action: r.action,
    programme: r.programme,
    topic: r.topic,
    assetClass: r.assetClass,
    reason: r.reason,
    priority: r.priority,
    priorityScore: r.priorityScore,
    owner: r.owner,
    channel: r.channel,
    timing: r.timing,
    notBefore: r.notBefore ? r.notBefore.toISOString() : null,
    confidence: r.confidence,
    evidence: arr<EvidenceItem>(r.evidence),
    scoreInputs: arr<ScoreInput>(r.scoreInputs),
    suppression: arr<Suppression>(r.suppression),
    policyResult: (r.policyResult ?? { consent: "ok", consentPurpose: null, consentReason: null, window: "not_applicable", guardrails: "ok", approvalNeeded: false, approver: null }) as PolicyResult,
    alternatives: arr<Alternative>(r.alternatives),
    status: r.status,
    feedback: (r.feedback ?? []).map((f) => ({ kind: f.kind, reason: f.reason, at: f.createdAt.toISOString() })),
    outcomes: (r.outcomes ?? []).map((o) => ({ kind: o.kind, daysAfter: o.daysAfter, detail: o.detail })),
    disagreement: r.disagreement ?? null,
    legacy: legacy?.programme ? { programme: legacy.programme, action: legacy.action ?? "", topic: legacy.topic ?? null, owner: legacy.owner ?? "" } : null,
    correlationNote: CORRELATION_NOTE,
  };
}

export const RESULT_LABEL: Record<DecisionView["result"], string> = { RECOMMEND: "Recommendation", NO_ACTION: "No action", ABSTAIN: "Abstained" };
export const ABSTAIN_LABEL: Record<string, string> = { do_not_know: "Not enough to go on", evidence_conflict: "Evidence conflicts", data_stale: "Data too old", human_review_required: "Needs a person to review", do_not_contact: "Do not contact" };
export const SUPPRESSION_LABEL: Record<string, string> = {
  open_complaint: "Open complaint", consent_dnd: "Consent or do-not-contact", declined_class: "Recently declined", rm_low_acceptance: "RM marked low acceptance", recent_contact: "Contacted recently", dismissed_or_snoozed: "Dismissed or snoozed",
  unreachable: "Unreachable", kyc_exception: "Open exception", compliance_concern: "Compliance", whatsapp_window: "WhatsApp window", agent_disabled: "AI agent off", product_stance: "Product stance", product_registry: "Product registry", data_stale: "Data age",
};
