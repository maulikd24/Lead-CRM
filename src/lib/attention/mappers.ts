import type { Anomaly } from "./anomalies";
import type { AttentionCandidate, ValueBand } from "./engine";

/**
 * Row to AttentionCandidate, one small pure function per source. The numbers are the v1 judgement table in one place; the
 * sources (sources.ts) only fetch rows. No free text from a customer conversation, ticket or message is ever copied into an item:
 * titles are built from the kind, the customer's name and an age.
 */
const D = 86_400_000;
const ageDays = (from: Date, now: Date) => Math.max(0, (now.getTime() - from.getTime()) / D);
type Level = 1 | 2 | 3 | 4 | 5;
const lv = (n: number): Level => Math.max(1, Math.min(5, Math.round(n))) as Level;
const clientHref = (id: string) => `/clients/${id}`;
const ago = (days: number) => (days < 1 ? "today" : days < 2 ? "1 day ago" : `${Math.floor(days)} days ago`);

/** Heuristic bands on the customer's largest open opportunity (rupees). A judgement table, not a policy. */
export function bandForValue(estimatedValue: number | null): ValueBand {
  if (estimatedValue === null || !Number.isFinite(estimatedValue) || estimatedValue <= 0) return "unknown";
  if (estimatedValue < 500_000) return "low";
  if (estimatedValue < 2_500_000) return "medium";
  if (estimatedValue < 10_000_000) return "high";
  return "top";
}

type ClientRef = { id: string; name: string; assignedToId: string | null };
const subject = (c: ClientRef) => ({ type: "client" as const, id: c.id, label: c.name });

export function complaintCandidate(r: { id: string; kind: "COMPLAINT" | "COMPLIANCE_CONCERN"; severity: string | null; occurredAt: Date; client: ClientRef }, now: Date, value: ValueBand): AttentionCandidate {
  const compliance = r.kind === "COMPLIANCE_CONCERN";
  const sev = r.severity === "high" ? 5 : r.severity === "medium" ? 4 : 3;
  const age = ageDays(r.occurredAt, now);
  return {
    kind: "complaint",
    subKind: compliance ? "compliance_concern" : "complaint",
    sourceRef: r.id,
    subject: subject(r.client),
    ownerUserId: r.client.assignedToId,
    title: `${compliance ? "Compliance concern" : "Open complaint"}: ${r.client.name}`,
    detail: `Raised ${ago(age)}. Detected from a conversation and not yet confirmed by a person: please confirm or dismiss it on the customer's page.`,
    importance: lv(sev),
    urgency: lv(age >= 3 ? 5 : age >= 1 ? 4 : 3),
    risk: compliance ? 5 : 4,
    confidence: "medium",
    confirmed: false, // extracted by AI from a conversation: unconfirmed until a person confirms it
    valueBand: value,
    occurredAt: r.occurredAt,
    override: compliance ? "compliance" : "complaint",
    href: clientHref(r.client.id),
  };
}

export function commitmentCandidate(r: { id: string; dueAt: Date; occurredAt: Date; client: ClientRef }, now: Date, value: ValueBand): AttentionCandidate {
  const overdue = ageDays(r.dueAt, now);
  return {
    kind: "overdue_commitment", sourceRef: r.id, subject: subject(r.client), ownerUserId: r.client.assignedToId,
    title: `Overdue promise to ${r.client.name}`, detail: `Promised for ${ago(overdue)}, not yet marked done.`,
    importance: 4, urgency: lv(overdue >= 5 ? 5 : overdue >= 2 ? 4 : 3), risk: 3, confidence: "medium", confirmed: false, valueBand: value, occurredAt: r.dueAt, override: "none", href: clientHref(r.client.id),
  };
}

export function kycBlockerCandidate(r: { id: string; createdAt: Date; client: ClientRef }, now: Date, value: ValueBand): AttentionCandidate {
  const age = ageDays(r.createdAt, now);
  return {
    kind: "kyc_blocker", sourceRef: r.id, subject: subject(r.client), ownerUserId: r.client.assignedToId,
    title: `KYC blocked: ${r.client.name}`, detail: `Blocked ${ago(age)}. Resolve the exception to move the customer on.`,
    importance: 4, urgency: lv(age >= 5 ? 5 : age >= 2 ? 4 : 3), risk: 3, confidence: "high", confirmed: true, valueBand: value, occurredAt: r.createdAt, override: "none", href: clientHref(r.client.id),
  };
}

export function hotLeadCandidate(r: { id: string; createdAt: Date; client: ClientRef }, now: Date, value: ValueBand): AttentionCandidate {
  const age = ageDays(r.createdAt, now);
  return {
    kind: "hot_lead", sourceRef: r.id, subject: subject(r.client), ownerUserId: r.client.assignedToId,
    title: `High-priority lead not yet contacted: ${r.client.name}`, detail: `Arrived ${ago(age)}; no call, message or meeting logged yet.`,
    importance: 4, urgency: lv(age >= 2 ? 5 : age >= 1 ? 4 : 3), risk: 2, confidence: "high", confirmed: true, valueBand: value, occurredAt: r.createdAt, override: "none", href: clientHref(r.client.id),
  };
}

export function opportunityCandidate(r: { id: string; stage: string; stageEnteredAt: Date; ownerId: string; client: ClientRef }, now: Date, value: ValueBand): AttentionCandidate {
  const days = ageDays(r.stageEnteredAt, now);
  const stageImportance = r.stage === "DECISION_PENDING" ? 5 : r.stage === "RECOMMENDATION" ? 4 : 3;
  return {
    kind: "customer_opportunity", sourceRef: r.id, subject: subject(r.client), ownerUserId: r.ownerId,
    title: `Opportunity waiting: ${r.client.name}`, detail: `In "${r.stage.toLowerCase().replace(/_/g, " ")}" for ${Math.floor(days)} days.`,
    importance: lv(stageImportance), urgency: lv(days >= 14 ? 5 : days >= 7 ? 4 : 2), risk: 2, confidence: "high", confirmed: true, valueBand: value, occurredAt: r.stageEnteredAt, override: "none", href: clientHref(r.client.id),
  };
}

/** A decision-engine candidate (the next-best-action today, DecisionRecord later) offered as an opportunity. A rule suggestion, so confidence is medium. */
export function decisionCandidate(r: { clientId: string; clientName: string; ownerId: string | null; action: string; topic: string | null; priorityScore: number; computedAt: Date }, value: ValueBand): AttentionCandidate {
  return {
    kind: "customer_opportunity", subKind: "next_best_action", sourceRef: `nba:${r.clientId}`, subject: { type: "client", id: r.clientId, label: r.clientName }, ownerUserId: r.ownerId,
    title: `Suggested next step for ${r.clientName}: ${r.action.toLowerCase()}${r.topic ? ` on ${r.topic}` : ""}`, detail: "From the next-best-action rules. Open the customer to see why.",
    importance: lv(r.priorityScore >= 80 ? 4 : 3), urgency: 2, risk: 2, confidence: "medium", confirmed: true, valueBand: value, occurredAt: r.computedAt, override: "none", href: clientHref(r.clientId),
  };
}

export function taskCandidate(r: { id: string; title: string; dueAt: Date; category: string; assignedToId: string; client: ClientRef & { priority: string } }, now: Date, value: ValueBand): AttentionCandidate {
  const overdueDays = (now.getTime() - r.dueAt.getTime()) / D;
  const urgency = overdueDays >= 2 ? 5 : overdueDays >= 0 ? 4 : overdueDays >= -1 / 6 ? 3 : 2;
  const importance = r.category === "FUNDING" || r.client.priority === "HIGH" ? 4 : r.client.priority === "LOW" ? 2 : 3;
  return {
    kind: "task", sourceRef: r.id, subject: subject(r.client), ownerUserId: r.assignedToId,
    title: r.title, detail: overdueDays >= 0 ? `Overdue by ${Math.max(0, Math.floor(overdueDays))} days.` : "Due soon.",
    importance: lv(importance), urgency: lv(urgency), risk: 2, confidence: "high", confirmed: true, valueBand: value, occurredAt: r.dueAt, override: "none", href: "/tasks",
  };
}

export type FailureLike = { key: string; source: string; group: string; label: string; reason: string; lastSeen: Date; count: number; stillFailing: boolean; agent: boolean };
export type AlertLike = { id: string; key: string; severity: string; title: string; firstRaisedAt: Date };

/** Admin system items: integrations and jobs that are failing now, agent failures, and open control-plane alerts (a CRITICAL one is a critical incident). */
export function integrationCandidates(failures: readonly FailureLike[], alerts: readonly AlertLike[], now: Date): AttentionCandidate[] {
  const out: AttentionCandidate[] = [];
  for (const f of failures) {
    if (!f.stillFailing) continue;
    out.push({
      kind: f.agent ? "agent_failure" : "failed_integration", sourceRef: f.key, subject: { type: "system", id: f.group, label: f.label }, ownerUserId: null,
      title: `${f.label} is failing`, detail: `${f.reason}. ${f.count} failure${f.count === 1 ? "" : "s"}, latest ${ago(ageDays(f.lastSeen, now))}.`,
      importance: f.count >= 5 ? 4 : 3, urgency: lv(ageDays(f.lastSeen, now) < 1 ? 4 : 3), risk: 3, confidence: "high", confirmed: true, valueBand: "unknown", occurredAt: f.lastSeen, override: "none", href: "/settings/control-plane?tab=failures",
    });
  }
  for (const a of alerts) {
    const critical = a.severity === "CRITICAL";
    out.push({
      kind: "failed_integration", subKind: "control_plane_alert", sourceRef: `alert:${a.id}`, subject: { type: "system", id: a.key, label: a.title }, ownerUserId: null,
      title: a.title, detail: `${critical ? "Critical alert" : "Alert"} raised ${ago(ageDays(a.firstRaisedAt, now))}.`,
      importance: critical ? 5 : 3, urgency: critical ? 5 : 3, risk: critical ? 5 : 3, confidence: "high", confirmed: true, valueBand: "unknown", occurredAt: a.firstRaisedAt, override: critical ? "critical_incident" : "none", href: "/settings/control-plane",
    });
  }
  return out;
}

export function approvalCandidate(r: { id: string; actionType: string; requestedAt: Date }, now: Date): AttentionCandidate {
  const age = ageDays(r.requestedAt, now);
  return {
    kind: "approval", sourceRef: r.id, subject: { type: "system", id: r.id, label: r.actionType.toLowerCase().replace(/_/g, " ") }, ownerUserId: null,
    title: `Approval waiting: ${r.actionType.toLowerCase().replace(/_/g, " ")}`, detail: `Waiting ${ago(age)}.`,
    importance: 3, urgency: lv(age >= 2 ? 5 : age >= 1 ? 4 : 3), risk: 3, confidence: "high", confirmed: true, valueBand: "unknown", occurredAt: r.requestedAt, override: "none", href: "/settings/approval-workflows",
  };
}

export function dataQualityCandidate(r: { ref: string; ownerUserId: string | null; title: string; detail: string; count: number; since: Date; href: string }): AttentionCandidate {
  return {
    kind: "data_quality", sourceRef: r.ref, subject: { type: "system", id: r.ref, label: r.title }, ownerUserId: r.ownerUserId, title: r.title, detail: r.detail,
    importance: r.count >= 20 ? 3 : 2, urgency: 2, risk: 2, confidence: "high", confirmed: true, valueBand: "unknown", occurredAt: r.since, override: "none", href: r.href,
  };
}

export function campaignCandidate(a: Pick<Anomaly, "campaignId" | "campaignName" | "type" | "severity" | "detail">, now: Date): AttentionCandidate {
  const high = a.severity === "high";
  return {
    kind: "campaign_anomaly", subKind: a.type, sourceRef: `${a.campaignId}:${a.type}`, subject: { type: "campaign", id: a.campaignId, label: a.campaignName }, ownerUserId: null,
    title: `${a.campaignName}: ${a.type === "spend_spike" ? "spend spike" : a.type === "spend_no_leads" ? "spend with no leads" : "spend stopped"}`, detail: a.detail,
    importance: high ? 4 : 3, urgency: high ? 4 : 3, risk: high ? 4 : 3, confidence: "high", confirmed: true, valueBand: "unknown", occurredAt: now, override: "none", href: "/marketing",
  };
}
