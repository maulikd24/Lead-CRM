import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { createTaskIfNotExists } from "@/lib/stage-engine/create-task-if-not-exists";
import { syncNextAction } from "@/lib/stage-engine/next-action";

import {
  commitmentTransition,
  complaintTransition,
  slaDueAt,
  type CommitmentAction,
  type ComplaintAction,
  type ComplaintSeverityName,
  type ServiceCode,
} from "./rules";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type ServiceResult<T = object> = ({ ok: true } & T) | { ok: false; code: ServiceCode | "NOT_FOUND" | "SOURCE_NOT_FOUND" | "INVALID"; message: string };
const fail = (code: Extract<ServiceResult, { ok: false }>["code"], message: string): Extract<ServiceResult, { ok: false }> => ({ ok: false, code, message });

/** Ids and states only: the append-only audit chain never carries what a customer complained about. */
async function audit(tx: Tx, userId: string, entity: "Complaint" | "Commitment", id: string, action: string, newValue: Record<string, unknown>, reason?: string | null) {
  await tx.auditLog.create({ data: { userId, entity, entityId: id, action, newValue: newValue as Prisma.InputJsonValue, reason: reason ?? null } });
}

// ---- complaints -----------------------------------------------------------------------------------------------------------------------------
export type RegisterComplaint = {
  clientId: string;
  title: string;
  summary?: string | null;
  severity: ComplaintSeverityName;
  ownerId?: string | null;
  source: { type: "MANUAL" } | { type: "TICKET" | "INSIGHT" | "CALL"; ref: string };
  actorId: string;
  now?: Date;
};

/**
 * Registers a complaint as a managed case. The ticket, insight or call it came from is LINKED by id (and checked to belong to this
 * customer), not copied; registering the same source twice returns the first case. The owner defaults to the customer's RM and gets
 * a Task due at the SLA deadline, so the work shows up where RMs already look.
 */
export async function registerComplaint(input: RegisterComplaint): Promise<ServiceResult<{ complaintId: string; existed: boolean }>> {
  const now = input.now ?? new Date();
  if (!input.actorId || input.actorId === "system") return fail("ACTOR_REQUIRED", "A named person must do this.");
  const title = input.title?.trim();
  if (!title || title.length > 200) return fail("INVALID", "A complaint needs a short title.");
  if ((input.summary ?? "").length > 500) return fail("INVALID", "Keep the summary under 500 characters; link the source instead of pasting it.");

  const result = await prisma.$transaction(async (tx): Promise<ServiceResult<{ complaintId: string; existed: boolean; ownerId: string | null; slaDueAt: Date }>> => {
    const client = await tx.client.findUnique({ where: { id: input.clientId }, select: { id: true, assignedToId: true } });
    if (!client) return fail("NOT_FOUND", "Customer not found.");

    let openedAt = now;
    let dedupeKey: string | null = null;
    let link: { supportTicketId?: string; insightId?: string; reviewId?: string } = {};
    if (input.source.type === "TICKET") {
      const t = await tx.supportTicket.findFirst({ where: { id: input.source.ref, clientId: input.clientId }, select: { id: true, ticketCreatedAt: true } });
      if (!t) return fail("SOURCE_NOT_FOUND", "That ticket was not found for this customer.");
      link = { supportTicketId: t.id };
      dedupeKey = `ticket:${t.id}`;
      openedAt = t.ticketCreatedAt ?? now;
    } else if (input.source.type === "INSIGHT") {
      const i = await tx.conversationInsight.findFirst({ where: { id: input.source.ref, clientId: input.clientId }, select: { id: true, occurredAt: true } });
      if (!i) return fail("SOURCE_NOT_FOUND", "That insight was not found for this customer.");
      link = { insightId: i.id };
      dedupeKey = `insight:${i.id}`;
      openedAt = i.occurredAt;
    } else if (input.source.type === "CALL") {
      const r = await tx.conversationReview.findFirst({ where: { id: input.source.ref, clientId: input.clientId }, select: { id: true, createdAt: true } });
      if (!r) return fail("SOURCE_NOT_FOUND", "That call or conversation was not found for this customer.");
      link = { reviewId: r.id };
      dedupeKey = `review:${r.id}`;
      openedAt = r.createdAt;
    }
    if (openedAt.getTime() > now.getTime()) openedAt = now;

    if (dedupeKey) {
      const existing = await tx.complaint.findUnique({ where: { dedupeKey }, select: { id: true, ownerId: true, slaDueAt: true } });
      if (existing) return { ok: true, complaintId: existing.id, existed: true, ownerId: existing.ownerId, slaDueAt: existing.slaDueAt };
    }

    let ownerId = input.ownerId ?? client.assignedToId ?? null;
    if (ownerId && (await tx.user.count({ where: { id: ownerId } })) === 0) ownerId = null;
    const due = slaDueAt(openedAt, input.severity);
    const created = await tx.complaint.create({
      data: { clientId: input.clientId, title, summary: input.summary?.trim() || null, severity: input.severity, status: "OPEN", ownerId, sourceType: input.source.type, ...link, dedupeKey, openedAt, slaDueAt: due, createdById: input.actorId },
    });
    await tx.complaintEvent.create({ data: { complaintId: created.id, type: "opened", toStatus: "OPEN", actorId: input.actorId, at: now } });
    await audit(tx, input.actorId, "Complaint", created.id, "complaint.opened", { clientId: input.clientId, severity: input.severity, sourceType: input.source.type, ownerId });
    return { ok: true, complaintId: created.id, existed: false, ownerId, slaDueAt: due };
  });
  if (!result.ok) return result;

  if (!result.existed && result.ownerId) {
    // The work item: one Task for the owner due at the SLA deadline. Best effort and outside the transaction: the case is real even if this fails.
    try {
      const task = await createTaskIfNotExists({ clientId: input.clientId, assignedToId: result.ownerId, title: `Resolve complaint: ${input.title.trim().slice(0, 120)}`, dueAt: result.slaDueAt, source: `complaint:${result.complaintId}` });
      await prisma.complaint.update({ where: { id: result.complaintId }, data: { taskId: task.id } });
    } catch (error) {
      console.error("complaint task failed", error instanceof Error ? error.name : "unknown");
    }
  }
  return { ok: true, complaintId: result.complaintId, existed: result.existed };
}

/** Moves a complaint through its lifecycle as a named person. Compare-and-set on the status so two people acting at once cannot both win. */
export async function actOnComplaint(complaintId: string, action: ComplaintAction, opts: { now?: Date } = {}): Promise<ServiceResult<{ status: string }>> {
  const now = opts.now ?? new Date();
  const outcome = await prisma.$transaction(async (tx): Promise<ServiceResult<{ status: string; clientId: string; taskId: string | null; ownerId: string | null; title: string; slaDueAt: Date }>> => {
    const row = await tx.complaint.findUnique({ where: { id: complaintId } });
    if (!row) return fail("NOT_FOUND", "Complaint not found.");
    const res = complaintTransition(row, action, now);
    if (!res.ok) return fail(res.code, res.message);
    const claimed = await tx.complaint.updateMany({ where: { id: complaintId, status: row.status }, data: res.patch as Prisma.ComplaintUncheckedUpdateManyInput });
    if (claimed.count !== 1) return fail("BAD_STATE", "Someone else changed this complaint. Refresh and try again.");
    const after = await tx.complaint.findUniqueOrThrow({ where: { id: complaintId } });
    await tx.complaintEvent.create({
      data: { complaintId, type: action.type === "set_severity" ? "severity_changed" : action.type === "assign" ? "owner_changed" : action.type === "start" ? "started" : action.type === "acknowledge" ? "acknowledged" : action.type === "resolve" ? "resolved" : action.type === "close" ? "closed" : "reopened", fromStatus: row.status, toStatus: after.status, actorId: action.actorId, note: "reason" in action ? action.reason : "resolution" in action ? action.resolution : null, at: now },
    });
    await audit(tx, action.actorId, "Complaint", complaintId, `complaint.${action.type}`, { clientId: row.clientId, from: row.status, to: after.status, severity: after.severity }, "reason" in action ? action.reason : null);
    return { ok: true, status: after.status, clientId: row.clientId, taskId: after.taskId, ownerId: after.ownerId, title: after.title, slaDueAt: after.slaDueAt };
  });
  if (!outcome.ok) return outcome;

  // Keep the linked Task honest: done when the complaint is resolved, back when it is reopened.
  try {
    if ((action.type === "resolve" || action.type === "close") && outcome.taskId) {
      await prisma.task.updateMany({ where: { id: outcome.taskId, status: { in: ["PENDING", "OVERDUE"] } }, data: { status: "DONE" } });
      await syncNextAction(outcome.clientId);
    }
    if (action.type === "reopen" && outcome.ownerId) {
      const task = await createTaskIfNotExists({ clientId: outcome.clientId, assignedToId: outcome.ownerId, title: `Resolve complaint (reopened): ${outcome.title.slice(0, 100)}`, dueAt: outcome.slaDueAt, source: `complaint:${complaintId}` });
      await prisma.complaint.update({ where: { id: complaintId }, data: { taskId: task.id } });
    }
  } catch (error) {
    console.error("complaint task sync failed", error instanceof Error ? error.name : "unknown");
  }
  return { ok: true, status: outcome.status };
}

// ---- commitments -----------------------------------------------------------------------------------------------------------------------------
export type RegisterCommitment = {
  clientId: string;
  text: string;
  dueAt: Date;
  promisedByType: "RM" | "CRM" | "AI_AGENT" | "ALLVEST";
  promisedById?: string | null;
  ownerId?: string | null;
  promisedToType?: "CUSTOMER" | "INTERNAL";
  source?: { type: "MANUAL" } | { type: "INSIGHT" | "CALL" | "TASK"; ref: string };
  actorId: string;
  now?: Date;
};

/** A person records a promise. It is born confirmed (a person said it is real) and gets a Task for the owner when there is one. */
export async function registerCommitment(input: RegisterCommitment): Promise<ServiceResult<{ commitmentId: string; existed: boolean }>> {
  const now = input.now ?? new Date();
  if (!input.actorId || input.actorId === "system") return fail("ACTOR_REQUIRED", "A named person must do this.");
  const text = input.text?.trim();
  if (!text || text.length > 300) return fail("INVALID", "Say what was promised, in a sentence.");
  if (Number.isNaN(input.dueAt.getTime())) return fail("INVALID", "A commitment needs a due date.");

  const result = await prisma.$transaction(async (tx): Promise<ServiceResult<{ commitmentId: string; existed: boolean; ownerId: string | null }>> => {
    const client = await tx.client.findUnique({ where: { id: input.clientId }, select: { id: true, assignedToId: true } });
    if (!client) return fail("NOT_FOUND", "Customer not found.");
    let link: { insightId?: string; reviewId?: string; taskId?: string } = {};
    let dedupeKey: string | null = null;
    const src = input.source ?? { type: "MANUAL" as const };
    if (src.type === "INSIGHT") {
      if ((await tx.conversationInsight.count({ where: { id: src.ref, clientId: input.clientId } })) === 0) return fail("SOURCE_NOT_FOUND", "That insight was not found for this customer.");
      link = { insightId: src.ref };
      dedupeKey = `insight:${src.ref}`;
    } else if (src.type === "CALL") {
      if ((await tx.conversationReview.count({ where: { id: src.ref, clientId: input.clientId } })) === 0) return fail("SOURCE_NOT_FOUND", "That call was not found for this customer.");
      link = { reviewId: src.ref };
    } else if (src.type === "TASK") {
      if ((await tx.task.count({ where: { id: src.ref, clientId: input.clientId } })) === 0) return fail("SOURCE_NOT_FOUND", "That task was not found for this customer.");
      link = { taskId: src.ref };
    }
    if (dedupeKey) {
      const existing = await tx.commitment.findUnique({ where: { dedupeKey }, select: { id: true, ownerId: true, confirmedAt: true } });
      if (existing) {
        // A person recording a promise that the AI had only suggested accepts it.
        if (!existing.confirmedAt) await tx.commitment.update({ where: { id: existing.id }, data: { confirmedById: input.actorId, confirmedAt: now, text, dueAt: input.dueAt } });
        return { ok: true, commitmentId: existing.id, existed: true, ownerId: existing.ownerId };
      }
    }
    const ownerId = input.ownerId ?? input.promisedById ?? client.assignedToId ?? null;
    const created = await tx.commitment.create({
      data: { clientId: input.clientId, promisedByType: input.promisedByType, promisedById: input.promisedById ?? null, promisedToType: input.promisedToType ?? "CUSTOMER", text, dueAt: input.dueAt, ownerId, sourceType: src.type, ...link, dedupeKey, confirmedById: input.actorId, confirmedAt: now, createdById: input.actorId },
    });
    await audit(tx, input.actorId, "Commitment", created.id, "commitment.registered", { clientId: input.clientId, sourceType: src.type, ownerId });
    return { ok: true, commitmentId: created.id, existed: false, ownerId };
  });
  if (!result.ok) return result;
  if (!result.existed && result.ownerId) {
    try {
      const task = await createTaskIfNotExists({ clientId: input.clientId, assignedToId: result.ownerId, title: `Keep promise: ${text.slice(0, 120)}`, dueAt: input.dueAt, source: `commitment:${result.commitmentId}` });
      await prisma.commitment.update({ where: { id: result.commitmentId }, data: { taskId: task.id } });
    } catch (error) {
      console.error("commitment task failed", error instanceof Error ? error.name : "unknown");
    }
  }
  return { ok: true, commitmentId: result.commitmentId, existed: result.existed };
}

export async function actOnCommitment(commitmentId: string, action: CommitmentAction, opts: { now?: Date } = {}): Promise<ServiceResult<{ status: string }>> {
  const now = opts.now ?? new Date();
  const outcome = await prisma.$transaction(async (tx): Promise<ServiceResult<{ status: string; taskId: string | null; clientId: string }>> => {
    const row = await tx.commitment.findUnique({ where: { id: commitmentId } });
    if (!row) return fail("NOT_FOUND", "Commitment not found.");
    if (!row.confirmedAt) return fail("BAD_STATE", "Accept this suggested commitment first.");
    const res = commitmentTransition(row, action, now);
    if (!res.ok) return fail(res.code, res.message);
    const claimed = await tx.commitment.updateMany({ where: { id: commitmentId, status: row.status }, data: res.patch as Prisma.CommitmentUncheckedUpdateManyInput });
    if (claimed.count !== 1) return fail("BAD_STATE", "Someone else changed this commitment. Refresh and try again.");
    const after = await tx.commitment.findUniqueOrThrow({ where: { id: commitmentId } });
    await audit(tx, action.actorId, "Commitment", commitmentId, `commitment.${action.type}`, { clientId: row.clientId, from: row.status, to: after.status }, "note" in action ? action.note : null);
    return { ok: true, status: after.status, taskId: after.taskId, clientId: row.clientId };
  });
  if (!outcome.ok) return outcome;
  if (action.type === "keep" || action.type === "cancel") {
    try {
      if (outcome.taskId) {
        await prisma.task.updateMany({ where: { id: outcome.taskId, status: { in: ["PENDING", "OVERDUE"] } }, data: { status: action.type === "keep" ? "DONE" : "CANCELLED" } });
        await syncNextAction(outcome.clientId);
      }
    } catch (error) {
      console.error("commitment task sync failed", error instanceof Error ? error.name : "unknown");
    }
  }
  return { ok: true, status: outcome.status };
}

/** A person accepts a commitment that was suggested from a conversation. Only then does it count as overdue when late. */
export async function acceptSuggestedCommitment(commitmentId: string, actorId: string, now: Date = new Date()): Promise<ServiceResult> {
  if (!actorId || actorId === "system") return fail("ACTOR_REQUIRED", "A named person must do this.");
  const r = await prisma.commitment.updateMany({ where: { id: commitmentId, confirmedAt: null }, data: { confirmedById: actorId, confirmedAt: now } });
  if (r.count !== 1) return fail("NOT_FOUND", "Nothing to accept.");
  await prisma.$transaction(async (tx) => audit(tx, actorId, "Commitment", commitmentId, "commitment.accepted", {}, null));
  return { ok: true };
}

/**
 * Builds SUGGESTED commitments from COMMITMENT insights (the existing extraction). A suggestion has no confirmation yet, so it is
 * listed for a person to accept and is never counted as overdue. An insight with no due date is not turned into a commitment
 * (we do not invent a deadline). Re-running adds nothing new: the insight id is the dedupe key.
 */
export async function suggestCommitmentsFromInsights(clientId: string): Promise<{ created: number; skippedNoDueDate: number }> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { assignedToId: true } });
  if (!client) return { created: 0, skippedNoDueDate: 0 };
  const insights = await prisma.conversationInsight.findMany({ where: { clientId, kind: "COMMITMENT" }, take: 100, orderBy: { occurredAt: "desc" } });
  let created = 0;
  let skipped = 0;
  for (const i of insights) {
    if (!i.dueAt) { skipped++; continue; }
    const exists = await prisma.commitment.count({ where: { dedupeKey: `insight:${i.id}` } });
    if (exists) continue;
    await prisma.commitment.create({
      data: {
        clientId,
        promisedByType: "RM",
        promisedById: client.assignedToId,
        text: i.text.slice(0, 300),
        dueAt: i.dueAt,
        ownerId: client.assignedToId,
        sourceType: "INSIGHT",
        insightId: i.id,
        dedupeKey: `insight:${i.id}`,
        status: i.status === "DONE" ? "KEPT" : i.status === "DISMISSED" ? "CANCELLED" : "OPEN",
        keptAt: i.status === "DONE" ? (i.resolvedAt ?? i.occurredAt) : null,
        cancelledAt: i.status === "DISMISSED" ? (i.resolvedAt ?? i.occurredAt) : null,
      },
    });
    created++;
  }
  return { created, skippedNoDueDate: skipped };
}
