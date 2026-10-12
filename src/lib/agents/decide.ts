import type { Role } from "@/generated/prisma/client";
import type { ProposalStatus } from "./proposal-state";
import { checkOutbound } from "./guardrails";

export type StoredProposal = { id: string; clientId: string; assignedToId: string | null; status: ProposalStatus; body: string; expiresAt: Date };
type Actor = { id: string; role: Role };

export type TransitionPatch = { decidedById?: string; decidedAt?: Date; messageId?: string; blockedReason?: string; body?: string };

export type DecideDeps = {
  load: (id: string) => Promise<StoredProposal | null>;
  /**
   * Atomic compare-and-set: moves the row from `from` to `to` only if it is still in `from`
   * (and, with `notExpiredAt`, still unexpired at that instant). Resolves true only if exactly one row changed.
   */
  transition: (id: string, from: ProposalStatus, to: ProposalStatus, patch?: TransitionPatch, opts?: { notExpiredAt?: Date }) => Promise<boolean>;
  send: (input: { user: Actor; clientId: string; body: string }) => Promise<{ messageId: string }>;
  now: () => Date;
};

export type DecideResult = { ok: true; messageId?: string } | { ok: false; error: string };

/** Same rule as canReplyTo: ADMIN, or the RM the customer is assigned to. Managers are view-only. */
function mayAct(user: Actor, p: StoredProposal): boolean {
  return user.role === "ADMIN" || (user.role === "RM" && p.assignedToId === user.id);
}

export async function approveProposal(deps: DecideDeps, input: { proposalId: string; user: Actor; editedBody?: string }): Promise<DecideResult> {
  // 1. Fast fail on a stale read; the conditional writes below are what actually guarantee single-send.
  const p = await deps.load(input.proposalId);
  if (!p || !mayAct(input.user, p)) return { ok: false, error: "Draft not found" };
  if (p.status !== "DRAFT") return { ok: false, error: `This draft is already ${p.status.toLowerCase()}` };
  if (p.expiresAt.getTime() <= deps.now().getTime()) {
    await deps.transition(p.id, "DRAFT", "EXPIRED");
    return { ok: false, error: "This draft has expired" };
  }

  // 2. A human wrote or reviewed this text, so only the regex layer re-checks it (no LLM judge here).
  const body = (input.editedBody ?? p.body).trim();
  const verdict = checkOutbound(body);
  if (!verdict.ok) {
    await deps.transition(p.id, "DRAFT", "BLOCKED", { blockedReason: `${verdict.code}: ${verdict.detail}`, decidedById: input.user.id, decidedAt: deps.now() });
    return { ok: false, error: `Message blocked: ${verdict.detail}` };
  }

  // 3. Claim: atomic with the expiry check. Only one caller can win; the loser never sends.
  const at = deps.now();
  const claimed = await deps.transition(p.id, "DRAFT", "APPROVED", { decidedById: input.user.id, decidedAt: at, body }, { notExpiredAt: at });
  if (!claimed) return { ok: false, error: "This draft was already decided or has expired" };

  // 4. Send. queueWhatsAppReply fails before creating a Message in every error path, so releasing the claim is safe.
  let messageId: string;
  try {
    ({ messageId } = await deps.send({ user: input.user, clientId: p.clientId, body }));
  } catch (error) {
    await deps.transition(p.id, "APPROVED", "DRAFT").catch((e) => console.error(`agent proposal ${p.id}: could not release claim after send failure`, e));
    return { ok: false, error: error instanceof Error ? error.message : "Could not send" };
  }

  // 5. The message exists. Never throw or release from here: the row stays APPROVED so it can never be sent twice.
  try {
    if (!(await deps.transition(p.id, "APPROVED", "SENT", { messageId }))) console.error(`agent proposal ${p.id}: message ${messageId} sent but APPROVED->SENT matched no row`);
  } catch (e) {
    console.error(`agent proposal ${p.id}: message ${messageId} sent but the SENT write failed`, e);
  }
  return { ok: true, messageId };
}

export async function rejectProposal(deps: DecideDeps, input: { proposalId: string; user: Actor }): Promise<DecideResult> {
  const p = await deps.load(input.proposalId);
  if (!p || !mayAct(input.user, p)) return { ok: false, error: "Draft not found" };
  if (p.status !== "DRAFT") return { ok: false, error: `This draft is already ${p.status.toLowerCase()}` };
  const done = await deps.transition(p.id, "DRAFT", "REJECTED", { decidedById: input.user.id, decidedAt: deps.now() });
  return done ? { ok: true } : { ok: false, error: "This draft was already decided" };
}
