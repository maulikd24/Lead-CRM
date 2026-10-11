import type { Role } from "@/generated/prisma/client";

import type { AutonomyLevel } from "./autonomy";
import type { Actor, ApprovalAdapter, ApprovalDefinition, ApprovalKind, ApproveNeed, CanonicalApproval, Decision, DecisionResult, SubjectRef } from "./contract";
import { parseRef } from "./contract";
import { approverKinds, definitionOf, isKind, mayApprove, requesterOnlyKinds, visibleKinds } from "./definitions";
import type { CanonicalState } from "./state";

/**
 * The one approval service. Pure: every table and side effect comes in through `deps`, so the whole decision (who sees what, who may
 * decide, four-eyes, reasons, evidence, consent, expiry, audit, write-through) is unit tested without a database.
 *
 * The legacy path stays authoritative. This service decides whether a decision may be attempted at all, hands it to the adapter, which
 * calls the legacy code unchanged (including its compare-and-set), and records the outcome. It never approves anything by itself:
 * there is no auto-approval, and an agent or system identity is refused.
 */
export type MirrorRecord = {
  kind: ApprovalKind;
  id: string;
  subject: SubjectRef;
  decision: Decision;
  state: CanonicalState;
  actorId: string;
  /** The person who asked, when there is one (an agent or a job has none). */
  requesterId?: string | null;
  reason: string | null;
  correlationId: string;
  causationId: string | null;
  autonomy: AutonomyLevel;
  decidedAt: Date;
};

export type AuditEntry = { userId: string; entity: "Approval"; entityId: string; action: "approval_approved" | "approval_rejected"; newValue: Record<string, unknown>; reason: string | null };

export type ServiceDeps = {
  adapters: Partial<Record<ApprovalKind, ApprovalAdapter>>;
  now: () => Date;
  audit: (entry: AuditEntry) => Promise<void>;
  writeThrough: (kind: ApprovalKind) => boolean;
  mirror: (record: MirrorRecord) => Promise<void>;
  /** The consent check for a purpose and channel, or undefined while consent enforcement is off. */
  consentGate: (purpose: string, channel: string | null) => ((clientId: string) => Promise<{ allowed: boolean; reason?: string }>) | undefined;
};

export type ItemActions = { canApprove: boolean; canReject: boolean; inlineApprove: boolean; needs: readonly ApproveNeed[]; blocked: string | null; /** Four-eyes: this person made it, so it is not theirs to decide. */ selfBlocked: boolean };
export type InboxItem = CanonicalApproval & { actions: ItemActions };
export type ListResult = { items: InboxItem[]; counts: Partial<Record<ApprovalKind, number>> };

export const FOUR_EYES_TEXT = "Someone else has to approve this: it needs a second pair of eyes.";
const LIST_CAP = 200;
const NONE: ItemActions = { canApprove: false, canReject: false, inlineApprove: false, needs: [], blocked: null, selfBlocked: false };

const isHuman = (actor: Actor) => !!actor.id && !/^(agent|system)(:|$)/i.test(actor.id);
const missingEvidence = (def: ApprovalDefinition, item: CanonicalApproval) => def.requiredEvidence.filter((k) => !item.evidence.some((e) => e.key === k && e.value.trim() !== ""));

/** What this person may do with this item right now. Used by the list (to show buttons) and by `decide` (to refuse), so they cannot disagree. */
export function actionsFor(item: CanonicalApproval, actor: Actor): ItemActions {
  const def = definitionOf(item.kind);
  if (item.state !== "requested") return NONE;
  if (!mayApprove(actor.role, item.kind)) return { ...NONE, blocked: "You cannot decide this kind of request." };
  if (def.fourEyes && item.fourEyesAuthorId === actor.id) return { ...NONE, blocked: FOUR_EYES_TEXT, selfBlocked: true };
  const missing = missingEvidence(def, item);
  const canApprove = def.supports.approve && missing.length === 0;
  return {
    canApprove,
    canReject: def.supports.reject,
    inlineApprove: def.inlineApprove,
    needs: def.approveNeeds,
    blocked: def.supports.approve && missing.length ? `Missing evidence: ${missing.join(", ")}.` : null,
    selfBlocked: false,
  };
}

const needsMet = (needs: readonly ApproveNeed[], params: Record<string, unknown>) => needs.every((n) => (n === "survivorId" ? typeof params.survivorId === "string" && params.survivorId !== "" : params[n] === true));
const fail = (code: Extract<DecisionResult, { ok: false }>["code"], error: string, reasons?: string[]): DecisionResult => ({ ok: false, code, error, ...(reasons ? { reasons } : {}) });

export function createApprovalService(deps: ServiceDeps) {
  const adapterFor = (kind: ApprovalKind) => deps.adapters[kind];

  async function listFor(actor: Actor, opts: { tab: "awaiting" | "mine"; kind?: ApprovalKind; limit?: number }): Promise<ListResult> {
    const now = deps.now();
    const limit = Math.min(opts.limit ?? LIST_CAP, LIST_CAP);
    const role = actor.role as Role;
    const kinds = (opts.tab === "awaiting" ? approverKinds(role) : visibleKinds(role)).filter((k) => adapterFor(k));
    const per = await Promise.all(
      kinds.map(async (kind) => {
        const adapter = adapterFor(kind)!;
        const rows = opts.tab === "awaiting" ? await adapter.listAwaiting(actor, now, limit) : await adapter.listRequestedBy(actor, now, limit);
        return rows.map((r): InboxItem => ({ ...r, actions: actionsFor(r, actor) }));
      }),
    );
    let all = per.flat();
    // "Awaiting me" is only what this person can act on; a request they made themselves is in "mine".
    if (opts.tab === "awaiting") all = all.filter((i) => i.state === "requested" && !i.actions.selfBlocked);
    const counts: ListResult["counts"] = {};
    for (const i of all) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
    const filtered = opts.kind ? all.filter((i) => i.kind === opts.kind) : all;
    filtered.sort((a, b) => (opts.tab === "awaiting" ? a.requestedAt.getTime() - b.requestedAt.getTime() : b.requestedAt.getTime() - a.requestedAt.getTime()));
    return { items: filtered.slice(0, limit), counts };
  }

  async function get(actor: Actor, ref: string): Promise<InboxItem | null> {
    const p = parseRef(ref);
    if (!p || !isKind(p.kind)) return null;
    if (!visibleKinds(actor.role as Role).includes(p.kind)) return null;
    const adapter = adapterFor(p.kind);
    const row = adapter ? await adapter.get(p.id, actor, deps.now()) : null;
    return row ? { ...row, actions: actionsFor(row, actor) } : null;
  }

  async function decide(actor: Actor, ref: string, decision: Decision, input: { reason?: string | null; params?: Record<string, unknown> }): Promise<DecisionResult> {
    if (!isHuman(actor)) return fail("NOT_HUMAN", "Only a signed-in person can decide an approval.");
    const parsed = parseRef(ref);
    if (!parsed || !isKind(parsed.kind)) return fail("NOT_FOUND", "That request could not be found.");
    const kind = parsed.kind;
    const adapter = adapterFor(kind);
    if (!adapter) return fail("NOT_FOUND", "That request could not be found.");
    const def = definitionOf(kind);
    if (!mayApprove(actor.role as Role, kind)) return fail("FORBIDDEN", "You cannot decide this kind of request.");

    const now = deps.now();
    const item = await adapter.get(parsed.id, actor, now);
    if (!item) return fail("NOT_FOUND", "That request could not be found.");
    if (item.state === "expired") {
      await adapter.expire?.(parsed.id, now);
      return fail("EXPIRED", "This request has expired.");
    }
    if (item.state !== "requested") return fail("ALREADY_DECIDED", `This request is already ${item.state}.`);

    if (decision === "approve" ? !def.supports.approve : !def.supports.reject) return fail("UNSUPPORTED", decision === "approve" ? "This kind of request cannot be approved here." : "This kind of request cannot be rejected here. Prepare it again instead.");
    if (def.fourEyes && item.fourEyesAuthorId === actor.id) return fail("SELF_APPROVAL", FOUR_EYES_TEXT);

    const reason = (input.reason ?? "").trim().slice(0, 500) || null;
    const params = input.params ?? {};
    if (decision === "reject" && !reason) return fail("REASON_REQUIRED", "Say why you are rejecting this.");

    if (decision === "approve") {
      const missing = missingEvidence(def, item);
      if (missing.length) return fail("EVIDENCE_MISSING", `This cannot be approved yet: missing ${missing.join(", ")}.`);
      if (!def.inlineApprove) return fail("NEEDS_INPUT", "This one cannot be approved in the list. Open it to check the details and confirm.");
      if (!needsMet(def.approveNeeds, params)) return fail("NEEDS_INPUT", "Tick the confirmation first.");
      if (item.clientId) {
        for (const pre of def.preconditions) {
          if (pre.type !== "consent") continue;
          const gate = deps.consentGate(pre.purpose, pre.channel);
          if (!gate) continue; // consent enforcement is off: the same as the legacy path
          const verdict = await gate(item.clientId);
          if (!verdict.allowed) return fail("PRECONDITION", "There is no consent on record for this customer and channel, so this cannot go out.");
        }
      }
    }

    const outcome = await adapter.decide({ subjectId: parsed.id, decision, reason, actor, now, params });
    if (!outcome.ok) return outcome.reasons ? fail(outcome.code, outcome.error, outcome.reasons) : fail(outcome.code, outcome.error);

    const after = await adapter.get(parsed.id, actor, deps.now()).catch(() => null);
    const state: CanonicalState = after?.state ?? (decision === "approve" ? "approved" : "rejected");

    try {
      await deps.audit({
        userId: actor.id,
        entity: "Approval",
        entityId: ref,
        action: decision === "approve" ? "approval_approved" : "approval_rejected",
        newValue: { kind, subjectType: item.subject.type, subjectId: item.subject.id, state, correlationId: item.correlationId, causationId: item.causationId, autonomy: item.autonomy, via: "approvals-inbox" },
        reason,
      });
    } catch (error) {
      console.error(`approval ${ref}: decided, but the audit row could not be written`, error instanceof Error ? error.name : "unknown");
    }
    if (deps.writeThrough(kind)) {
      try {
        await deps.mirror({ kind, id: parsed.id, subject: item.subject, decision, state, actorId: actor.id, requesterId: item.requestedBy?.id ?? null, reason, correlationId: item.correlationId, causationId: item.causationId, autonomy: item.autonomy, decidedAt: now });
      } catch (error) {
        console.error(`approval ${ref}: decided, but the canonical record could not be written`, error instanceof Error ? error.name : "unknown");
      }
    }
    return { ok: true, state, approval: after, ...(outcome.messageId ? { messageId: outcome.messageId } : {}) };
  }

  return { listFor, get, decide };
}

export type ApprovalService = ReturnType<typeof createApprovalService>;
export { approverKinds, requesterOnlyKinds };
