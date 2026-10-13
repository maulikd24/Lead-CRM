import { assertMayExecute } from "@/lib/agents/autonomy";
import type { Actor } from "@/lib/policy/types";

import { checkDraft, type DraftCheck, type DraftContext, type DraftKind } from "./draft";

/**
 * The approval gate for AI-drafted customer messages (AI execution layer, bible 08).
 *
 *  - requestDraftApproval(): stores a draft as an ApprovalRequest (actionType CUSTOMER_MESSAGE_DRAFT). Nothing is sent.
 *  - dispatchApprovedDraft(): the ONLY function that may hand a draft to a sender. It refuses unless the request exists, is of the
 *    right type, is APPROVED by someone other than the requester, has not expired, and the autonomy ladder allows L4 execution with
 *    that approval as its reference. The sender is injected: the existing WhatsApp send path is not wired here (an owner decision).
 */
export const CUSTOMER_MESSAGE_DRAFT = "CUSTOMER_MESSAGE_DRAFT";
export const DRAFT_ACTION_TYPE = "draft_customer_message" as const;

export type DraftPayload = {
  clientId: string;
  channel: "whatsapp";
  kind: DraftKind;
  body: string;
  source: "model" | "template";
  note: string | null;
};

export type ApprovalRequestRow = {
  id: string;
  actionType: string;
  entity: string;
  entityId: string;
  status: string;
  payload: unknown;
  requestedById: string;
  decidedById: string | null;
  expiresAt: Date | null;
};

export type RequestApprovalFn = (
  actionType: "CUSTOMER_MESSAGE_DRAFT",
  input: { entity: string; entityId: string; payload: DraftPayload; reason?: string; expiresAt?: Date; correlationId?: string; autonomyLevel?: string },
  actor: Actor,
) => Promise<{ id: string }>;

/** Drafts go stale: an approval for a message written days ago is not an approval of what the customer now needs. */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export async function requestDraftApproval(
  draft: { clientId: string; kind: DraftKind; body: string; source: "model" | "template"; note: string | null; correlationId?: string },
  actor: Actor,
  deps: { requestApproval: RequestApprovalFn; now: () => Date },
): Promise<{ approvalRequestId: string }> {
  const payload: DraftPayload = { clientId: draft.clientId, channel: "whatsapp", kind: draft.kind, body: draft.body, source: draft.source, note: draft.note };
  const row = await deps.requestApproval(
    CUSTOMER_MESSAGE_DRAFT,
    {
      entity: "Client",
      entityId: draft.clientId,
      payload,
      reason: draft.kind === "service_response" ? "AI draft: service response" : "AI draft: conversation",
      expiresAt: new Date(deps.now().getTime() + DRAFT_TTL_MS),
      correlationId: draft.correlationId,
      autonomyLevel: "L3",
    },
    actor,
  );
  return { approvalRequestId: row.id };
}

export class DraftNotApprovedError extends Error {
  constructor(readonly approvalRequestId: string, reason: string) {
    super(`Draft ${approvalRequestId} cannot be sent: ${reason}`);
    this.name = "DraftNotApprovedError";
  }
}

export type DispatchDeps = {
  load: (approvalRequestId: string) => Promise<ApprovalRequestRow | null>;
  now: () => Date;
  /** The AI kill switch state at send time. False refuses the send (see sendEnabledFromEnv). */
  isSendEnabled: () => boolean;
  /** Re-runs the draft checks on the stored payload against the customer's CURRENT context (see recheckAgainst). */
  recheck: (payload: DraftPayload) => Promise<DraftCheck>;
  /**
   * Atomically marks the approval as sent (production: updateMany where status APPROVED and appliedAt null, then set appliedAt).
   * Resolves false when it was already sent, so a second dispatch on the same row sends nothing.
   */
  claimSend: (approvalRequestId: string) => Promise<boolean>;
  /** The sender. Injected: production wiring for the WhatsApp send path is an owner decision and is deliberately not bound here. */
  send: (payload: DraftPayload, approvalRequestId: string) => Promise<void>;
};

/** Sending is off whenever AI_KILL_SWITCH is "1" (the same meaning the gateway gives it). */
export function sendEnabledFromEnv(env: Record<string, string | undefined>): boolean {
  return env.AI_KILL_SWITCH !== "1";
}

/** A recheck that loads the customer's current draft context and runs the same checks as drafting. */
export function recheckAgainst(loadContext: (clientId: string) => Promise<DraftContext | null>): (payload: DraftPayload) => Promise<DraftCheck> {
  return async (payload) => {
    const ctx = await loadContext(payload.clientId);
    if (!ctx) return { ok: false, reason: "the customer's draft context is no longer available" };
    return checkDraft(payload.body, { ...ctx, kind: payload.kind });
  };
}

const isDraftPayload = (v: unknown): v is DraftPayload => {
  if (!v || typeof v !== "object") return false;
  const p = v as Partial<DraftPayload>;
  return typeof p.clientId === "string" && p.channel === "whatsapp" && typeof p.body === "string" && p.body.trim().length > 0 && (p.kind === "conversation" || p.kind === "service_response");
};

export async function dispatchApprovedDraft(approvalRequestId: string, deps: DispatchDeps): Promise<void> {
  const row = await deps.load(approvalRequestId);
  function refuse(reason: string): never {
    throw new DraftNotApprovedError(approvalRequestId, reason);
  }
  if (!row) refuse("no such approval request");
  if (row.actionType !== CUSTOMER_MESSAGE_DRAFT) refuse(`not a customer message draft (${row.actionType})`);
  if (row.status !== "APPROVED") refuse(`status is ${row.status}, not APPROVED`);
  if (!row.decidedById) refuse("no decision on record");
  if (row.decidedById === row.requestedById) refuse("the requester cannot also approve their own draft");
  if (row.expiresAt && row.expiresAt.getTime() <= deps.now().getTime()) refuse("the approval has expired");
  if (!isDraftPayload(row.payload)) refuse("the stored draft is malformed");
  if (row.payload.clientId !== row.entityId) refuse("the draft and the approval name different customers");
  // The autonomy ladder: a customer send executes at L4 only, with a human approval reference. Never L5, never without the reference.
  if (!deps.isSendEnabled()) refuse("the AI kill switch (AI_KILL_SWITCH) is on: nothing is sent");
  assertMayExecute({ actionType: DRAFT_ACTION_TYPE, level: 4, approvalRef: approvalRequestId, approvalStatus: row.status });
  // The customer may have changed since the draft was written (a new complaint, a sales block): the checks run again at send time.
  const recheck = await deps.recheck(row.payload);
  if (!recheck.ok) refuse(`the draft fails its checks now: ${recheck.reason}`);
  if (!(await deps.claimSend(approvalRequestId))) refuse("it was already sent");
  await deps.send(row.payload, approvalRequestId);
}
