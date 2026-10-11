import { APPROVABLE_AGENTS, LEAD_PUSH_AGENT, approveProposal, rejectProposal, type DecideDeps } from "@/lib/agents/decide";
import type { ProposalStatus } from "@/lib/agents/proposal-state";

import type { Actor, ApprovalAdapter, ApprovalKind, CanonicalApproval, DecideInput, LegacyOutcome } from "../contract";
import { defaultCorrelation, refOf } from "../contract";
import { effectiveState, type CanonicalState } from "../state";
import { clip, failure, personOf, states } from "./shared";

/**
 * AgentProposal (the WhatsApp nudger and the outcomes reviewer's drafts). The legacy path is agents/decide.ts and stays the ONLY code
 * that claims, sends and releases: approval calls approveProposal unchanged, so its compare-and-set (DRAFT -> APPROVED atomically with
 * the expiry check, then send, then SENT) is intact. This adapter reads the same rows and applies the same who-may-act rule.
 */
export type AgentRow = {
  id: string; agentKey: string; clientId: string; clientName: string | null; clientCode: string | null; assignedToId: string | null;
  status: ProposalStatus; body: string; reason: string; programme: string | null; channel: string; createdAt: Date; expiresAt: Date;
  decidedById: string | null; decidedAt: Date | null; blockedReason: string | null;
};

export type AgentAdapterDeps = {
  legacy: DecideDeps;
  loadAwaiting: (actor: Actor, now: Date, limit: number) => Promise<AgentRow[]>;
  loadRow: (id: string) => Promise<AgentRow | null>;
};

const STATE: Record<ProposalStatus, CanonicalState> = { DRAFT: "requested", APPROVED: "approved", SENT: "executed", REJECTED: "rejected", EXPIRED: "expired", BLOCKED: "failed" };

/** Same rule as agents/decide.ts mayAct: an Admin, or the RM the customer is assigned to. Managers are view-only. */
const mayAct = (actor: Actor, row: Pick<AgentRow, "assignedToId">) => actor.role === "ADMIN" || (actor.role === "RM" && row.assignedToId === actor.id);

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", email: "email", sms: "SMS" };
const sentence = (v: string) => (v ? v[0].toUpperCase() + v.slice(1) : v);

type DraftKind = Extract<ApprovalKind, "agent-proposal" | "lead-push-draft">;

export function toCanonicalAgentProposal(row: AgentRow, now: Date, kind: DraftKind = "agent-proposal"): CanonicalApproval {
  const label = row.clientName ?? row.clientCode ?? "Customer";
  return {
    ref: refOf(kind, row.id), kind, id: row.id,
    subject: { type: "Customer message", id: row.clientId, label, href: `/clients/${row.clientId}` },
    state: effectiveState(states(STATE, row.status), row.expiresAt, now),
    legacyState: row.status,
    summary: kind === "lead-push-draft" ? `Draft first message (${CHANNEL[row.channel] ?? row.channel}) to new lead ${label}` : `Draft ${CHANNEL[row.channel] ?? row.channel} message to ${label}`,
    requestedBy: null, requestedAt: row.createdAt,
    approver: personOf(row.decidedById), decidedAt: row.decidedAt, decisionReason: row.blockedReason,
    expiresAt: row.expiresAt,
    evidence: [
      { key: "draft", label: "Draft message", value: row.body },
      { key: "reason", label: "Why it was drafted", value: row.reason },
      ...(row.programme ? [{ key: "programme", label: "Programme", value: sentence(row.programme) }] : []),
      { key: "channel", label: "Channel", value: CHANNEL[row.channel] ?? row.channel },
    ],
    correlationId: defaultCorrelation(kind, row.id), causationId: null, autonomy: "L4",
    fourEyesAuthorId: null, clientId: row.clientId,
  };
}

const RULES = [[/already/i, "ALREADY_DECIDED"], [/expired/i, "EXPIRED"], [/blocked/i, "BLOCKED"], [/not found/i, "NOT_FOUND"]] as const;

/**
 * One kind per drafting agent family over the SAME AgentProposal rows and the SAME legacy decision code: the new lead's first message is
 * `lead-push-draft`, every other approvable draft is `agent-proposal`, and no row is listed under both (one door per draft).
 */
const LEAD_ONLY = (agentKey: string) => agentKey === LEAD_PUSH_AGENT;
const NOT_LEAD = (agentKey: string) => APPROVABLE_AGENTS.includes(agentKey) && agentKey !== LEAD_PUSH_AGENT;

export function createAgentProposalAdapter(deps: AgentAdapterDeps, opts: { kind?: DraftKind; accepts?: (agentKey: string) => boolean } = {}): ApprovalAdapter {
  const kind = opts.kind ?? "agent-proposal";
  const accepts = opts.accepts ?? NOT_LEAD;
  return {
    kind,
    async listAwaiting(actor, now, limit) {
      return (await deps.loadAwaiting(actor, now, limit)).filter((r) => accepts(r.agentKey) && mayAct(actor, r)).map((r) => toCanonicalAgentProposal(r, now, kind));
    },
    async listRequestedBy() {
      return [];
    },
    async get(id, actor, now) {
      const row = await deps.loadRow(id);
      return row && accepts(row.agentKey) && mayAct(actor, row) ? toCanonicalAgentProposal(row, now, kind) : null;
    },
    async decide(input: DecideInput): Promise<LegacyOutcome> {
      const user = { id: input.actor.id, role: input.actor.role };
      const editedBody = typeof input.params.editedBody === "string" ? clip(input.params.editedBody, 5000) : undefined;
      const res = input.decision === "approve" ? await approveProposal(deps.legacy, { proposalId: input.subjectId, user, editedBody }) : await rejectProposal(deps.legacy, { proposalId: input.subjectId, user });
      return res.ok ? { ok: true, ...(res.messageId ? { messageId: res.messageId } : {}) } : failure(res.error, RULES);
    },
    async expire(id) {
      await deps.legacy.transition(id, "DRAFT", "EXPIRED").catch(() => false);
    },
  };
}

/** The new lead's first message (campaign attribution). Same rows, same compare-and-set send, its own kind and definition. */
export const createLeadPushDraftAdapter = (deps: AgentAdapterDeps): ApprovalAdapter => createAgentProposalAdapter(deps, { kind: "lead-push-draft", accepts: LEAD_ONLY });
