import { flowCorrelationId } from "@/lib/events/envelope";

import { emptyBundle, type Bundle, type ComplaintRow, type DecisionRow, type EventRow, type MessageRow, type ProposalRow, type RunRow, type TaskRow } from "./bundle";

/** Seeded chains shared by the unit tests (and mirrored by the real-database suite). Plain data only. */
export const C = "client_1";
export const T0 = new Date("2027-05-10T04:00:00Z");
export const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
export const HOUR = 60;
export const DAY = 24 * 60;
const flow = flowCorrelationId(C);

export const users = new Map([["rm1", "Riya Menon"], ["mgr1", "Manish Kapoor"], ["adm1", "Anil Desai"], ["mkt1", "Meera Shah"]]);

let n = 0;
const ev = (o: Partial<EventRow> & { eventType: string; occurredAt: Date }): EventRow => {
  n += 1;
  return { id: `ev_${n}`, eventId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, actorType: "system", actorId: null, clientId: C, source: "crm.web", correlationId: flow, causationId: null, metadata: null, consentContext: null, ...o };
};
export { ev };

export const decision = (o: Partial<DecisionRow> & { id: string; createdAt: Date }): DecisionRow => ({
  clientId: C, engineVersion: "v2.0.0-shadow", correlationId: `corr_${o.id}`, causationId: null, mode: "SHADOW", result: "RECOMMEND", abstainReason: null, action: "nudge", programme: "kyc",
  topic: null, reason: "KYC has been pending for 6 days", priority: "high", channel: "whatsapp", evidence: [{ kind: "fact", ref: "stage:KYC", text: "Customer is in the KYC stage", observedAt: o.createdAt.toISOString(), confirmation: "confirmed" }],
  suppression: [], policyResult: { consent: "ok", consentPurpose: "MARKETING_COMMS", consentReason: null, window: "ok", guardrails: "ok", approvalNeeded: true, approver: "RM" }, status: "OPEN", observedAt: o.createdAt, feedback: [], outcomes: [], ...o,
});

/** Chain 1: a complaint is raised, resolved two days later, and an RM schedules a review call an hour after. NO id ties the task to the complaint (legacy path): the link is inferred. */
export function complaintThenReview(opts: { explicitTask?: boolean } = {}): Bundle {
  const b = emptyBundle(C);
  const complaint: ComplaintRow = {
    id: "cmp1", clientId: C, severity: "HIGH", status: "RESOLVED", ownerId: "rm1", sourceType: "INSIGHT", taskId: null, insightId: "ins1", supportTicketId: null, openedAt: at(0), acknowledgedAt: at(30),
    resolvedAt: at(2 * DAY), closedAt: null, resolutionCode: "explained", createdById: null,
    events: [{ id: "ce1", type: "opened", actorId: null, at: at(0) }, { id: "ce2", type: "resolved", actorId: "rm1", at: at(2 * DAY) }],
  };
  const task: TaskRow = {
    id: "tsk1", clientId: C, assignedToId: "rm1", title: "Schedule customer review call", dueAt: at(5 * DAY), status: "PENDING", category: "MEETING",
    source: opts.explicitTask ? "complaint:cmp1" : "manual", createdAt: at(2 * DAY + HOUR), updatedAt: at(2 * DAY + HOUR),
  };
  b.complaints.push(complaint);
  b.tasks.push(task);
  b.events.push(ev({ eventType: "complaint.raised", occurredAt: at(0), metadata: { ref: { table: "ConversationInsight", id: "ins1" }, severity: "HIGH", via: "conversation" } }));
  b.users = users;
  return b;
}

/** Chain 2: the engine recommends a KYC nudge, the nudger drafts it (two model runs), the RM approves, it is sent, the customer replies. */
export function aiDraftApprovedThenSent(): Bundle {
  const b = emptyBundle(C);
  const d = decision({ id: "dec1", createdAt: at(0), outcomes: [{ id: "out1", kind: "response", eventRef: "msg_in1", occurredAt: at(DAY), daysAfter: 1 }], feedback: [{ id: "fb1", userId: "rm1", kind: "accept", reason: null, createdAt: at(10) }] });
  b.decisions.push(d);
  b.events.push(ev({ eventType: "nba.decision.created", occurredAt: at(0), source: "nba.engine", metadata: { ref: { table: "DecisionRecord", id: "dec1" }, decisionId: "dec1", programme: "kyc", result: "RECOMMEND" } }));
  const run = (id: string, purposeId: string, min: number): RunRow => ({ id, createdAt: at(min), agentKey: "wa_nudger", purposeId, status: "OK", reasonCode: null, correlationId: "7f1d0b0a-1111-4222-8333-444455556666", causationId: null, subjectType: "client", subjectId: C, approvalRef: null, costUsdEstimate: 0.0012, model: "claude-haiku" });
  b.runs.push(run("run1", "nudger.draft", 3), run("run2", "compliance.judge", 3.2));
  const p: ProposalRow = { id: "prop1", agentKey: "wa_nudger", clientId: C, programme: "kyc", channel: "whatsapp", status: "SENT", blockedReason: null, decidedById: "rm1", decidedAt: at(20), messageId: "msg1", createdAt: at(4), expiresAt: at(2 * DAY), nbaDecisionId: "dec1" };
  b.proposals.push(p);
  const m: MessageRow = { id: "msg1", clientId: C, channel: "whatsapp", provider: "openwa", direction: "OUTBOUND", templateId: null, status: "DELIVERED", origin: "crm", senderUserId: "rm1", createdAt: at(20), sentAt: at(20) };
  const reply: MessageRow = { id: "msg_in1", clientId: C, channel: "whatsapp", provider: "openwa", direction: "INBOUND", templateId: null, status: "READ", origin: "customer", senderUserId: null, createdAt: at(DAY), sentAt: at(DAY) };
  b.messages.push(m, reply);
  b.events.push(ev({ eventType: "whatsapp.message.sent", occurredAt: at(20), source: "whatsapp.worker", actorType: "user", actorId: "rm1", metadata: { ref: { table: "Message", id: "msg1" }, channel: "whatsapp", direction: "OUTBOUND" } }));
  b.audits.push({ id: "aud1", userId: "rm1", entity: "Approval", entityId: "agent-proposal:prop1", action: "approval_approved", timestamp: at(20), newValue: { kind: "agent-proposal", state: "executed", correlationId: "approval:agent-proposal:prop1", autonomy: "L4" } });
  b.approvals.push({ id: "apr_mirror1", actionType: "AGENT_PROPOSAL", entity: "Customer message", entityId: C, status: "APPROVED", requestedById: "rm1", requestedAt: at(20), decidedById: "rm1", decidedAt: at(20), decisionNote: null, appliedAt: at(20), correlationId: "approval:agent-proposal:prop1", causationId: null, autonomyLevel: "L4", mirror: { kind: "agent-proposal", subjectId: "prop1" } });
  b.users = users;
  return b;
}

/** Chain 3: the engine decides NOT to contact (open complaint blocks the nudge). Nothing was sent. */
export function decisionSuppressed(): Bundle {
  const b = emptyBundle(C);
  b.decisions.push(decision({
    id: "dec2", createdAt: at(3 * DAY), result: "NO_ACTION", action: "no_action", programme: "kyc", reason: "A formal complaint is open",
    suppression: [{ rule: "open_complaint", effect: "block", until: null, because: "An open complaint blocks sales and nudges", candidateId: "stage_gate:kyc" }],
    policyResult: { consent: "ok", consentPurpose: "MARKETING_COMMS", consentReason: null, window: "ok", guardrails: "ok", approvalNeeded: false, approver: null },
  }));
  b.events.push(ev({ eventType: "nba.decision.created", occurredAt: at(3 * DAY), source: "nba.engine", metadata: { ref: { table: "DecisionRecord", id: "dec2" }, decisionId: "dec2", programme: "kyc", result: "NO_ACTION" } }));
  b.users = users;
  return b;
}

/** Chain 4: the ad autopilot recommends a budget change, a marketing user approves, it is applied. No customer is involved. */
export function adRecommendationApplied(): Bundle {
  const b = emptyBundle(null);
  const corr = "9a3c1f00-0000-4000-8000-0000000000aa";
  const e1 = ev({ clientId: null, eventType: "campaign.autopilot.recommended", occurredAt: at(0), source: "meta.ads", actorType: "agent", actorId: "autopilot", correlationId: corr, metadata: { recommendationId: "rec1" } });
  const e2 = ev({ clientId: null, eventType: "campaign.autopilot.approved", occurredAt: at(60), source: "crm.web", actorType: "user", actorId: "mkt1", correlationId: corr, causationId: e1.eventId, metadata: { recommendationId: "rec1" } });
  const e3 = ev({ clientId: null, eventType: "campaign.autopilot.applied", occurredAt: at(65), source: "meta.ads", actorType: "system", actorId: null, correlationId: corr, causationId: e2.eventId, metadata: { recommendationId: "rec1" } });
  b.events.push(e1, e2, e3);
  b.approvals.push({ id: "apr1", actionType: "AUTOPILOT_ACTION", entity: "AdCampaign", entityId: "camp1", status: "APPROVED", requestedById: "adm1", requestedAt: at(1), decidedById: "mkt1", decidedAt: at(60), decisionNote: null, appliedAt: at(65), correlationId: corr, causationId: null, autonomyLevel: "L4", mirror: null });
  b.users = users;
  return b;
}
