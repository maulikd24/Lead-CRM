import { assertMayExecute } from "@/lib/agents/autonomy";
import { DRAFT_ACTION_TYPE, DRAFT_TTL_MS, DraftNotApprovedError } from "@/lib/ai-execution/approval";
import type { Actor } from "@/lib/policy/types";

/**
 * The approval gate for co-pilot replies to Freshdesk (Support SLA). Pure: the database, the approval service and the Freshdesk adapter
 * are injected, so every refusal below is tested on its own.
 *
 *  - requestReplyApproval(): stores the reviewed reply as an ApprovalRequest (FRESHDESK_REPLY_DRAFT). Nothing is sent.
 *  - dispatchApprovedReply(): the ONLY route to Freshdesk. It refuses unless the request exists, is of the right type, is APPROVED, was
 *    decided by someone other than the requester, has not expired, is not already sent, the AI kill switch is off, the autonomy ladder
 *    allows L4 with that approval as its reference, and the reply still passes every check against the ticket as it is now. The approver
 *    is the one who sends it: the decision is what releases the reply.
 */

export const FRESHDESK_REPLY_DRAFT = "FRESHDESK_REPLY_DRAFT" as const;

export type ReplyPayload = {
  clientId: string;
  ticketId: string;
  kind: "service_response";
  body: string;
  source: "model" | "template";
  note: string | null;
};

export type ReplyApprovalRow = {
  id: string;
  actionType: string;
  entity: string;
  entityId: string;
  status: string;
  payload: unknown;
  requestedById: string;
  decidedById: string | null;
  expiresAt: Date | null;
  appliedAt: Date | null;
};

export type RequestApprovalFn = (
  actionType: typeof FRESHDESK_REPLY_DRAFT,
  input: { entity: string; entityId: string; payload: ReplyPayload; reason?: string; expiresAt?: Date; autonomyLevel?: string },
  actor: Actor,
) => Promise<{ id: string }>;

export async function requestReplyApproval(reply: Omit<ReplyPayload, "kind"> & { kind?: "service_response" }, actor: Actor, deps: { requestApproval: RequestApprovalFn; now: () => Date }): Promise<{ approvalRequestId: string }> {
  const payload: ReplyPayload = { clientId: reply.clientId, ticketId: reply.ticketId, kind: "service_response", body: reply.body, source: reply.source, note: reply.note };
  const row = await deps.requestApproval(
    FRESHDESK_REPLY_DRAFT,
    { entity: "Client", entityId: reply.clientId, payload, reason: "Support co-pilot: reply to a Freshdesk ticket", expiresAt: new Date(deps.now().getTime() + DRAFT_TTL_MS), autonomyLevel: "L3" },
    actor,
  );
  return { approvalRequestId: row.id };
}

export type DispatchDeps = {
  load: (approvalRequestId: string) => Promise<ReplyApprovalRow | null>;
  now: () => Date;
  /** False when AI_KILL_SWITCH is on: nothing is sent. */
  isSendEnabled: () => boolean;
  /** Re-runs every check on the stored reply against the ticket and the customer as they are now. */
  recheck: (payload: ReplyPayload) => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Atomically marks the approval as applied (appliedAt null -> now). False when it was already sent. */
  claimSend: (approvalRequestId: string) => Promise<boolean>;
  /** Undoes the claim when the send itself fails, so a retry is possible. */
  releaseClaim: (approvalRequestId: string) => Promise<void>;
  /** The Freshdesk reply. Refused results come back as data; a thrown error is treated as not sent. */
  send: (payload: ReplyPayload) => Promise<{ ok: true; replyId: string | null } | { ok: false; error: string }>;
};

export const isReplyPayload = (v: unknown): v is ReplyPayload => {
  if (!v || typeof v !== "object") return false;
  const p = v as Partial<ReplyPayload>;
  return typeof p.clientId === "string" && typeof p.ticketId === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(p.ticketId) && typeof p.body === "string" && p.body.trim().length > 0 && p.kind === "service_response";
};

export async function dispatchApprovedReply(approvalRequestId: string, actor: Actor, deps: DispatchDeps): Promise<{ status: "sent"; replyId: string | null }> {
  const row = await deps.load(approvalRequestId);
  function refuse(reason: string): never {
    throw new DraftNotApprovedError(approvalRequestId, reason);
  }
  if (!row) refuse("no such approval request");
  if (row.actionType !== FRESHDESK_REPLY_DRAFT) refuse(`not a Freshdesk reply (${row.actionType})`);
  if (row.status !== "APPROVED") refuse(`status is ${row.status}, not APPROVED`);
  if (!row.decidedById) refuse("no decision on record");
  if (row.decidedById === row.requestedById) refuse("the requester cannot also approve their own reply");
  if (row.decidedById !== actor.id) refuse("only the person who approved the reply can send it");
  if (row.expiresAt && row.expiresAt.getTime() <= deps.now().getTime()) refuse("the approval has expired");
  if (!isReplyPayload(row.payload)) refuse("the stored reply is malformed");
  if (row.payload.clientId !== row.entityId) refuse("the reply and the approval name different customers");
  if (row.appliedAt) refuse("it was already sent");
  if (!deps.isSendEnabled()) refuse("the AI kill switch (AI_KILL_SWITCH) is on: nothing is sent");
  assertMayExecute({ actionType: DRAFT_ACTION_TYPE, level: 4, approvalRef: approvalRequestId, approvalStatus: row.status });
  const recheck = await deps.recheck(row.payload);
  if (!recheck.ok) refuse(`the reply fails its checks now: ${recheck.reason}`);
  if (!(await deps.claimSend(approvalRequestId))) refuse("it was already sent");
  let result: { ok: true; replyId: string | null } | { ok: false; error: string };
  try {
    result = await deps.send(row.payload);
  } catch {
    await deps.releaseClaim(approvalRequestId);
    throw new DraftNotApprovedError(approvalRequestId, "the Freshdesk reply failed; nothing was recorded as sent");
  }
  if (!result.ok) {
    await deps.releaseClaim(approvalRequestId);
    throw new DraftNotApprovedError(approvalRequestId, `Freshdesk did not accept the reply: ${result.error}`);
  }
  return { status: "sent", replyId: result.replyId };
}
