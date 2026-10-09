import { HANDOVER_PREFIX, REPLY_KEY } from "./reply-assist";
import type { ProposalStatus } from "./proposal-state";
import type { TransitionPatch } from "./decide";

/** The slice of an AgentProposal row the inbox panel needs. */
export type AssistRow = {
  id: string;
  status: ProposalStatus;
  body: string;
  originalBody: string;
  reason: string;
  blockedReason: string | null;
  createdAt: Date;
  expiresAt: Date;
  inputTokens: number;
  outputTokens: number;
};

/** Serialisable (plain strings) so it can cross the server-action boundary. Never carries the text of a blocked draft. */
export type AssistView =
  | { kind: "none" }
  | { kind: "draft"; id: string; body: string; reason: string; expiresAt: string }
  | { kind: "blocked"; id: string }
  | { kind: "needs_human"; id: string; detail: string };

const isHandover = (r: Pick<AssistRow, "status" | "blockedReason">) => r.status === "BLOCKED" && (r.blockedReason ?? "").startsWith(HANDOVER_PREFIX);

/** What the panel shows: the newest suggestion made after the customer's latest unanswered message. Rows are newest first. */
export function deriveAssistView(input: { rows: AssistRow[]; lastInboundAt: Date | null; unanswered: boolean; now: Date }): AssistView {
  if (!input.unanswered || !input.lastInboundAt) return { kind: "none" };
  const cur = input.rows.find((r) => r.createdAt.getTime() >= input.lastInboundAt!.getTime());
  if (!cur) return { kind: "none" };
  if (isHandover(cur)) return { kind: "needs_human", id: cur.id, detail: (cur.blockedReason ?? "").slice(HANDOVER_PREFIX.length).trim() };
  if (cur.status === "BLOCKED") return { kind: "blocked", id: cur.id };
  if (cur.status === "DRAFT" && cur.expiresAt.getTime() > input.now.getTime()) return { kind: "draft", id: cur.id, body: cur.body, reason: cur.reason, expiresAt: cur.expiresAt.toISOString() };
  return { kind: "none" };
}

export type SuggestionUsage = "USED_AS_IS" | "EDITED" | "DISMISSED" | "EXPIRED" | "BLOCKED" | "HANDOVER" | "PENDING";

/**
 * Eval metric derived from existing columns (no extra enum): SENT with body === originalBody is used as is, SENT with a
 * different body was edited by the RM, REJECTED is dismissed, EXPIRED is superseded by a newer customer message or a regenerate.
 * Token counts are the draft call's inputTokens/outputTokens on the same row.
 */
export function usageOf(p: { status: ProposalStatus; body: string; originalBody: string; blockedReason: string | null }): SuggestionUsage {
  switch (p.status) {
    case "SENT": case "APPROVED": return p.body.trim() === p.originalBody.trim() ? "USED_AS_IS" : "EDITED";
    case "REJECTED": return "DISMISSED";
    case "EXPIRED": return "EXPIRED";
    case "BLOCKED": return isHandover(p) ? "HANDOVER" : "BLOCKED";
    default: return "PENDING";
  }
}

export type SentDeps = {
  load: (id: string) => Promise<{ id: string; agentKey: string; clientId: string; status: ProposalStatus } | null>;
  transition: (id: string, from: ProposalStatus, to: ProposalStatus, patch?: TransitionPatch) => Promise<boolean>;
  now: () => Date;
};

/**
 * Called AFTER the RM's own send queued a message. The RM pressing send is the approval; this only records the outcome on the
 * suggestion (who, when, the final text, the message). Compare-and-set, so a dismissed or superseded suggestion is never touched.
 * Never throws for a lost race; the caller treats any failure here as non-fatal because the message is already queued.
 */
export async function recordSuggestionSent(deps: SentDeps, input: { proposalId: string; clientId: string; userId: string; finalBody: string; messageId: string }): Promise<boolean> {
  const p = await deps.load(input.proposalId);
  if (!p || p.agentKey !== REPLY_KEY || p.clientId !== input.clientId || p.status !== "DRAFT") return false;
  const claimed = await deps.transition(p.id, "DRAFT", "APPROVED", { decidedById: input.userId, decidedAt: deps.now(), body: input.finalBody.trim() });
  if (!claimed) return false;
  return deps.transition(p.id, "APPROVED", "SENT", { messageId: input.messageId });
}
