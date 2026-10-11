import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db/prisma";
import { consentDecision, type ConsentRow } from "@/lib/consent/decision";
import { resolvePolicy } from "@/lib/consent/policy";
import { seedSystemActor, getSystemActorId } from "@/lib/system/system-actor";
import type { Prisma } from "@/generated/prisma/client";

import { emitMemoryEvent, type MemoryEventType } from "./events";
import { parseEvidence, serializeEvidence } from "./evidence";
import {
  buildItemDefaults,
  consentPurposeFor,
  deriveConfidence,
  independentlySupported,
  isAiSource,
  planWrite,
  resolvedState,
  sameValue,
  transition,
  validateProposal,
  type Evidence,
  type ExistingItem,
  type MemoryAction,
  type MemoryClassName,
  type Proposal,
  type ValidationCode,
} from "./rules";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type MemoryActor = { type: "RM" | "MANAGER" | "ADMIN" | "SYSTEM" | "AI_AGENT"; /** The signed-in user, when a person is acting. */ userId: string | null; /** Agent key for AI_AGENT. */ agentKey?: string };

export type WriteInput = Proposal & { clientId: string; actor: MemoryActor; correlationId?: string; causationId?: string; now?: Date };

export type WriteResult =
  | { ok: true; outcome: "created"; itemId: string; confirmation: string }
  | { ok: true; outcome: "reaffirmed"; itemId: string }
  | { ok: true; outcome: "suppressed"; reason: string }
  | { ok: false; code: ValidationCode | "SOURCE_NOT_FOUND" | "CONSENT_MISSING" | "CLIENT_NOT_FOUND" | "NOT_FOUND" | "BAD_STATE" | "ACTOR_REQUIRED" | "NOT_CONFIRMABLE" | "REASON_REQUIRED"; message: string };

const fail = (code: Extract<WriteResult, { ok: false }>["code"], message: string): Extract<WriteResult, { ok: false }> => ({ ok: false, code, message });

// ---- helpers ---------------------------------------------------------------------------------------------------------------
const toExisting = (row: { id: string; class: string; key: string; value: unknown; sourceType: string; sourceRef: string; evidence: unknown; confidence: string; observedAt: Date; freshUntil: Date | null; confirmation: string; dataClass: string; consentBasis: string | null; createdAt: Date; rejectedAt: Date | null; supersededById: string | null; conflictsWithId: string | null }): ExistingItem => ({
  ...row,
  class: row.class as MemoryClassName,
  confidence: row.confidence as ExistingItem["confidence"],
  confirmation: row.confirmation as ExistingItem["confirmation"],
  evidence: parseEvidence(row.evidence),
});

async function auditUserId(actor: MemoryActor): Promise<string> {
  if (actor.userId) return actor.userId;
  try {
    return await getSystemActorId();
  } catch {
    await seedSystemActor();
    return getSystemActorId();
  }
}

async function audit(tx: Tx, actor: MemoryActor, action: string, item: { id: string; clientId: string; class: string; dataClass: string }, extra: Record<string, unknown> = {}, reason?: string | null) {
  // Ids and states only. The item's value and evidence are personal data and stay out of the append-only audit chain.
  await tx.auditLog.create({
    data: { userId: await auditUserId(actor), entity: "CustomerMemoryItem", entityId: item.id, action, newValue: { clientId: item.clientId, class: item.class, ...extra } as Prisma.InputJsonValue, reason: reason ?? null },
  });
}

const EVENT_FOR: Record<string, MemoryEventType> = {
  "memory.proposed": "customer.memory.proposed",
  "memory.confirmed": "customer.memory.confirmed",
  "memory.rejected": "customer.memory.rejected",
  "memory.expired": "customer.memory.expired",
  "memory.disputed": "customer.memory.disputed",
  "memory.superseded": "customer.memory.superseded",
};

async function emit(action: keyof typeof EVENT_FOR, item: { id: string; clientId: string; class: string; dataClass: string }, actor: MemoryActor, now: Date, correlationId?: string | null, causationId?: string | null) {
  await emitMemoryEvent({ type: EVENT_FOR[action], occurredAt: now, clientId: item.clientId, itemId: item.id, class: item.class, actorType: actor.type, actorId: actor.userId ?? actor.agentKey ?? null, correlationId: correlationId ?? null, causationId: causationId ?? null, dataClass: item.dataClass });
}

/** R2: a ref must resolve to a real row that belongs to the SAME customer. Evidence for one customer can never cite another's data. */
async function unresolvedRef(tx: Tx, clientId: string, refs: readonly string[]): Promise<string | null> {
  for (const ref of new Set(refs)) {
    const [kind, ...rest] = ref.split(":");
    const id = rest.join(":");
    let found: number;
    switch (kind) {
      case "insight": found = await tx.conversationInsight.count({ where: { id, clientId } }); break;
      case "review": found = await tx.conversationReview.count({ where: { id, clientId } }); break;
      case "activity": found = await tx.activity.count({ where: { id, clientId } }); break;
      case "ticket": found = await tx.supportTicket.count({ where: { id, clientId } }); break;
      case "task": found = await tx.task.count({ where: { id, clientId } }); break;
      case "consent": found = await tx.consentRecord.count({ where: { id, clientId } }); break;
      case "document": found = await tx.document.count({ where: { id, clientId } }); break;
      case "goal": found = await tx.customerGoal.count({ where: { id, clientId } }); break;
      case "message": found = await tx.message.count({ where: { id, clientId } }); break;
      case "complaint": found = await tx.complaint.count({ where: { id, clientId } }); break;
      case "commitment": found = await tx.commitment.count({ where: { id, clientId } }); break;
      case "user": found = await tx.user.count({ where: { id } }); break;
      case "import": found = 1; break;
      default: found = 0;
    }
    if (found === 0) return ref;
  }
  return null;
}

async function lockKey(tx: Tx, clientId: string, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memory:${clientId}:${key}`}))`;
}

/** R6 at derivation time: chat- and call-derived items need the matching consent. Reads the ledger, never the legacy flag. */
async function derivationConsentOk(tx: Tx, clientId: string, proposal: Proposal, now: Date): Promise<boolean> {
  const purpose = consentPurposeFor(proposal.sourceType);
  if (!purpose) return true;
  const rows = (await tx.consentRecord.findMany({ where: { clientId, purpose }, select: { id: true, purpose: true, channel: true, status: true, capturedAt: true, expiresAt: true, source: true, noticeVersion: true } })) as ConsentRow[];
  return consentDecision(rows, purpose, null, now, { policy: resolvePolicy() }).allowed;
}

// ---- write ---------------------------------------------------------------------------------------------------------------------
/**
 * The one way an item is created. Validates (R2, R5), checks source refs belong to this customer, checks consent for AI-derived
 * items (R6), then applies planWrite: reaffirm, suppress, create, or create DISPUTED beside a conflicting item (never over it).
 */
export async function writeMemoryItem(input: WriteInput): Promise<WriteResult> {
  const now = input.now ?? new Date();
  const proposal: Proposal = { class: input.class, key: input.key, value: input.value, sourceType: input.sourceType, sourceRef: input.sourceRef, evidence: input.evidence, observedAt: input.observedAt, dueAt: input.dueAt, freshUntil: input.freshUntil, quoteVerified: input.quoteVerified };
  const valid = validateProposal(proposal);
  if (!valid.ok) return fail(valid.code, valid.message);
  // An AI source may only be written by an AI actor, and a person's entry must be attributed to that person.
  if (isAiSource(input.sourceType) !== (input.actor.type === "AI_AGENT")) return fail("ACTOR_REQUIRED", "AI sources are written by an agent; people write human sources.");
  if (input.actor.type !== "AI_AGENT" && input.actor.type !== "SYSTEM" && !input.actor.userId) return fail("ACTOR_REQUIRED", "A named person must do this.");

  return prisma.$transaction(async (tx): Promise<WriteResult> => {
    const client = await tx.client.findUnique({ where: { id: input.clientId }, select: { id: true } });
    if (!client) return fail("CLIENT_NOT_FOUND", "Customer not found.");
    const missing = await unresolvedRef(tx, input.clientId, [proposal.sourceRef, ...proposal.evidence.map((e) => e.sourceRef)]);
    if (missing) return fail("SOURCE_NOT_FOUND", `The source ${missing} was not found for this customer.`);
    if (!(await derivationConsentOk(tx, input.clientId, proposal, now))) return fail("CONSENT_MISSING", "The customer has not agreed to this kind of processing.");

    await lockKey(tx, input.clientId, proposal.key);
    const rows = await tx.customerMemoryItem.findMany({ where: { clientId: input.clientId, key: proposal.key }, orderBy: { createdAt: "desc" }, take: 200 });
    const plan = planWrite(proposal, rows.map(toExisting), now);

    if (plan.kind === "suppress") return { ok: true, outcome: "suppressed", reason: plan.reason };

    if (plan.kind === "reaffirm") {
      const row = rows.find((r) => r.id === plan.itemId)!;
      const have = parseEvidence(row.evidence);
      const added = proposal.evidence.filter((e) => !have.some((h) => h.sourceRef === e.sourceRef));
      const evidence = [...have, ...added].slice(-20);
      const humanSource = !isAiSource(proposal.sourceType);
      const confidence = isAiSource(row.sourceType) && row.confirmation !== "CONFIRMED" ? deriveConfidence({ sourceType: row.sourceType as Proposal["sourceType"], evidence, quoteVerified: !!proposal.quoteVerified }) : row.confidence;
      await tx.customerMemoryItem.update({
        where: { id: row.id },
        data: {
          evidence: serializeEvidence(evidence),
          confidence,
          // Only a person or a system of record reaffirms freshness; the AI seeing it again adds evidence but not a "reconfirmed" stamp on a confirmed item.
          ...(humanSource || row.confirmation !== "CONFIRMED" ? { observedAt: proposal.observedAt > row.observedAt ? proposal.observedAt : row.observedAt } : {}),
          ...(humanSource ? { lastReconfirmedAt: now } : {}),
        },
      });
      return { ok: true, outcome: "reaffirmed", itemId: row.id };
    }

    const defaults = buildItemDefaults(proposal, now);
    const confirmation = plan.confirmation;
    const created = await tx.customerMemoryItem.create({
      data: {
        id: randomUUID(),
        clientId: input.clientId,
        class: proposal.class,
        key: proposal.key,
        value: proposal.value as Prisma.InputJsonValue,
        sourceType: proposal.sourceType,
        sourceRef: proposal.sourceRef,
        evidence: serializeEvidence(proposal.evidence),
        confidence: defaults.confidence,
        observedAt: proposal.observedAt,
        freshUntil: defaults.freshUntil,
        lastReconfirmedAt: confirmation === "CONFIRMED" ? now : null,
        confirmation,
        confirmedById: confirmation === "CONFIRMED" ? input.actor.userId : null,
        confirmedAt: confirmation === "CONFIRMED" ? now : null,
        ...(confirmation === "DISPUTED" ? { disputedAt: now, disputedReason: `Conflicts with another item for the same thing (${plan.conflictsWithId})` } : {}),
        conflictsWithId: plan.conflictsWithId,
        dataClass: defaults.dataClass,
        consentBasis: defaults.consentBasis,
        createdByType: input.actor.type,
        createdById: input.actor.userId ?? input.actor.agentKey ?? null,
        correlationId: input.correlationId ?? null,
      },
    });
    await audit(tx, input.actor, "memory.proposed", created, { key: created.key, confirmation, sourceType: created.sourceType, conflictsWithId: plan.conflictsWithId }, null);
    for (const id of plan.disputeExistingIds) {
      await tx.customerMemoryItem.update({ where: { id }, data: { confirmation: "DISPUTED", disputedAt: now, disputedReason: `A newer item disagrees (${created.id})`, conflictsWithId: created.id } });
      await audit(tx, input.actor, "memory.disputed", { id, clientId: input.clientId, class: created.class, dataClass: created.dataClass }, { by: created.id }, "A newer conflicting item was recorded");
    }
    await emit("memory.proposed", created, input.actor, now, input.correlationId, input.causationId);
    return { ok: true, outcome: "created", itemId: created.id, confirmation };
  });
}

// ---- human actions ------------------------------------------------------------------------------------------------------------
export type ActionContext = { now?: Date; correlationId?: string; /** An RM's own words backing a confirmation: stored as independent evidence. */ note?: string };

/** Confirm, reject, dispute or reconfirm one item as a named person. The caller has already checked the person may act on this customer. */
export async function actOnMemoryItem(itemId: string, action: MemoryAction, ctx: ActionContext = {}): Promise<WriteResult> {
  const now = ctx.now ?? new Date();
  return prisma.$transaction(async (tx): Promise<WriteResult> => {
    const row = await tx.customerMemoryItem.findUnique({ where: { id: itemId } });
    if (!row) return fail("NOT_FOUND", "Item not found.");
    await lockKey(tx, row.clientId, row.key);
    const fresh = (await tx.customerMemoryItem.findUnique({ where: { id: itemId } }))!;
    const item = toExisting(fresh);
    const result = transition(item, action, now);
    if (!result.ok) return fail(result.code, result.message);

    const patch: Prisma.CustomerMemoryItemUpdateInput = { ...(result.patch as Prisma.CustomerMemoryItemUpdateInput) };
    if (action.type === "confirm" && ctx.note?.trim()) {
      const evidence = [...parseEvidence(fresh.evidence), { sourceRef: `user:${action.actorId}`, summary: `Confirmed by the RM: ${ctx.note.trim().slice(0, 240)}`, observedAt: now }];
      patch.evidence = serializeEvidence(evidence);
    }
    // conflictsWithId is a plain column on the update input
    const updated = await tx.customerMemoryItem.update({ where: { id: itemId }, data: patch as Prisma.CustomerMemoryItemUncheckedUpdateInput });

    const actor: MemoryActor = { type: "RM", userId: action.actorId };
    const name = ({ confirm: "memory.confirmed", reject: "memory.rejected", dispute: "memory.disputed", reconfirm: "memory.confirmed" } as const)[action.type];
    await audit(tx, actor, name, updated, { key: updated.key, from: fresh.confirmation, to: updated.confirmation }, "reason" in action ? action.reason : null);

    if (action.type === "confirm") {
      // A person choosing this item settles the dispute: every other live item for the same key and a different value is superseded by it.
      const others = await tx.customerMemoryItem.findMany({ where: { clientId: updated.clientId, key: updated.key, id: { not: updated.id }, confirmation: { in: ["UNCONFIRMED", "CONFIRMED", "DISPUTED"] } } });
      for (const other of others) {
        if (sameValue(other.value, updated.value)) continue;
        await tx.customerMemoryItem.update({ where: { id: other.id }, data: { confirmation: "SUPERSEDED", supersededById: updated.id } });
        await audit(tx, actor, "memory.superseded", other, { by: updated.id }, "Settled by a person's confirmation");
        await emit("memory.superseded", other, actor, now, ctx.correlationId);
      }
    }
    await emit(name, updated, actor, now, ctx.correlationId);
    return { ok: true, outcome: "reaffirmed", itemId: updated.id };
  });
}

/** An RM corrects an item: the old one is SUPERSEDED by a new CONFIRMED one entered by that person (the chain keeps both). */
export async function editMemoryItem(itemId: string, input: { value: unknown; actorId: string; reason: string }, ctx: ActionContext = {}): Promise<WriteResult> {
  const now = ctx.now ?? new Date();
  if (!input.actorId || input.actorId === "system") return fail("ACTOR_REQUIRED", "A named person must do this.");
  if (!input.reason?.trim()) return fail("REASON_REQUIRED", "Say why.");
  return prisma.$transaction(async (tx): Promise<WriteResult> => {
    const row = await tx.customerMemoryItem.findUnique({ where: { id: itemId } });
    if (!row) return fail("NOT_FOUND", "Item not found.");
    await lockKey(tx, row.clientId, row.key);
    const item = toExisting(row);
    const state = resolvedState(item, now);
    if (state === "REJECTED" || state === "SUPERSEDED" || state === "EXPIRED") return fail("BAD_STATE", `A ${state.toLowerCase()} item cannot be edited.`);
    const proposal: Proposal = { class: item.class, key: item.key, value: input.value, sourceType: "rm_entry", sourceRef: `user:${input.actorId}`, evidence: [{ sourceRef: `user:${input.actorId}`, summary: `Corrected by the RM: ${input.reason.trim().slice(0, 240)}`, observedAt: now }], observedAt: now };
    const valid = validateProposal(proposal);
    if (!valid.ok) return fail(valid.code, valid.message);
    const defaults = buildItemDefaults(proposal, now);
    const created = await tx.customerMemoryItem.create({
      data: { id: randomUUID(), clientId: row.clientId, class: row.class, key: row.key, value: input.value as Prisma.InputJsonValue, sourceType: "rm_entry", sourceRef: proposal.sourceRef, evidence: serializeEvidence(proposal.evidence), confidence: "HIGH", observedAt: now, freshUntil: defaults.freshUntil, lastReconfirmedAt: now, confirmation: row.class === "SENTIMENT" ? "UNCONFIRMED" : "CONFIRMED", confirmedById: input.actorId, confirmedAt: now, dataClass: defaults.dataClass, consentBasis: null, createdByType: "RM", createdById: input.actorId, correlationId: ctx.correlationId ?? null },
    });
    await tx.customerMemoryItem.update({ where: { id: row.id }, data: { confirmation: "SUPERSEDED", supersededById: created.id } });
    const actor: MemoryActor = { type: "RM", userId: input.actorId };
    await audit(tx, actor, "memory.superseded", row, { by: created.id }, input.reason.trim());
    await audit(tx, actor, "memory.proposed", created, { key: created.key, confirmation: created.confirmation, sourceType: "rm_entry", supersedes: row.id }, input.reason.trim());
    // Other live items for the key that disagree with the correction are superseded by it too (the person has decided).
    const others = await tx.customerMemoryItem.findMany({ where: { clientId: row.clientId, key: row.key, id: { notIn: [row.id, created.id] }, confirmation: { in: ["UNCONFIRMED", "CONFIRMED", "DISPUTED"] } } });
    for (const other of others) {
      if (sameValue(other.value, input.value)) continue;
      await tx.customerMemoryItem.update({ where: { id: other.id }, data: { confirmation: "SUPERSEDED", supersededById: created.id } });
      await audit(tx, actor, "memory.superseded", other, { by: created.id }, "Settled by a correction");
    }
    await emit("memory.superseded", row, actor, now, ctx.correlationId);
    await emit("memory.proposed", created, actor, now, ctx.correlationId);
    return { ok: true, outcome: "created", itemId: created.id, confirmation: created.confirmation };
  });
}

// ---- housekeeping ---------------------------------------------------------------------------------------------------------------
/** R4: moves live items past their freshUntil to EXPIRED (with an audit row each). Reads already treat them as expired; this makes the stored state and the audit trail agree. */
export async function expireDueMemoryItems(opts: { now?: Date; limit?: number } = {}): Promise<{ expired: number }> {
  const now = opts.now ?? new Date();
  const actor: MemoryActor = { type: "SYSTEM", userId: null };
  return prisma.$transaction(async (tx) => {
    const due = await tx.customerMemoryItem.findMany({ where: { confirmation: { in: ["UNCONFIRMED", "CONFIRMED", "DISPUTED"] }, freshUntil: { lte: now } }, take: opts.limit ?? 500, orderBy: { freshUntil: "asc" } });
    for (const row of due) {
      await tx.customerMemoryItem.update({ where: { id: row.id }, data: { confirmation: "EXPIRED" } });
      await audit(tx, actor, "memory.expired", row, { from: row.confirmation, reason: "fresh_until_passed" });
      await emit("memory.expired", row, actor, now);
    }
    return { expired: due.length };
  });
}

/**
 * R6: the customer withdrew a consent purpose. Items derived under it are expired and excluded; a CONFIRMED item stays only if
 * independently supported (a person's note, a document, a goal or a ledger entry stands behind it).
 */
export async function expireOnConsentWithdrawal(clientId: string, purpose: string, opts: { now?: Date } = {}): Promise<{ expired: number; kept: number }> {
  const now = opts.now ?? new Date();
  const actor: MemoryActor = { type: "SYSTEM", userId: null };
  return prisma.$transaction(async (tx) => {
    const rows = await tx.customerMemoryItem.findMany({ where: { clientId, consentBasis: purpose, confirmation: { in: ["UNCONFIRMED", "CONFIRMED", "DISPUTED"] } } });
    let expired = 0;
    let kept = 0;
    for (const row of rows) {
      if (row.confirmation === "CONFIRMED" && independentlySupported({ sourceType: row.sourceType, evidence: parseEvidence(row.evidence) })) {
        kept++;
        continue;
      }
      await tx.customerMemoryItem.update({ where: { id: row.id }, data: { confirmation: "EXPIRED" } });
      await audit(tx, actor, "memory.expired", row, { from: row.confirmation, reason: `consent_withdrawn:${purpose}` });
      await emit("memory.expired", row, actor, now);
      expired++;
    }
    return { expired, kept };
  });
}

export type { Evidence };
