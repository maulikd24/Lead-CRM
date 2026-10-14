import { prisma } from "@/lib/db/prisma";
import type { Actor } from "../types";
import { getApprovalDefinition, hasApprovalDefinition, type ApprovalActionType, type ApprovalDecisionOptions } from "./registry";

/** An approval that cannot go ahead as things stand. `reasons` are plain sentences for the screen. The request stays pending. */
export class ApprovalBlockedError extends Error {
  constructor(message: string, public readonly reasons: string[]) {
    super(message);
    this.name = "ApprovalBlockedError";
  }
}

/**
 * `db` is the client the row is written with. Pass a transaction client to make the write part of a larger atomic step (a check
 * and the create under one lock); by default it is the application client.
 */
export async function requestApproval(
  actionType: ApprovalActionType,
  input: { entity: string; entityId: string; payload: unknown; reason?: string; expiresAt?: Date; correlationId?: string; causationId?: string; autonomyLevel?: string },
  actor: Actor,
  db: Pick<typeof prisma, "approvalRequest"> = prisma,
) {
  const def = getApprovalDefinition(actionType);
  if (!def.canRequest(actor)) throw new Error("Not authorized to request this action");
  return db.approvalRequest.create({
    data: {
      actionType,
      entity: input.entity,
      entityId: input.entityId,
      payload: input.payload as object,
      reason: input.reason,
      requestedById: actor.id,
      // Canonical fields (optional; absent means the request behaves exactly as before).
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.causationId ? { causationId: input.causationId } : {}),
      ...(input.autonomyLevel ? { autonomyLevel: input.autonomyLevel } : {}),
    },
  });
}

export async function decideApproval(
  approvalRequestId: string,
  decision: "APPROVED" | "REJECTED",
  decisionNote: string | undefined,
  actor: Actor,
  options?: ApprovalDecisionOptions,
) {
  const req = await prisma.approvalRequest.findUnique({ where: { id: approvalRequestId } });
  if (!req) throw new Error("Approval request not found");
  if (req.status !== "PENDING") throw new Error(`Approval request already ${req.status}`);
  // A request past its expiry can be neither approved nor rejected: the clock decided first. Requests with no expiry (all of them today) skip this.
  if (req.expiresAt && req.expiresAt.getTime() <= Date.now()) {
    await prisma.approvalRequest.updateMany({ where: { id: approvalRequestId, status: "PENDING" }, data: { status: "EXPIRED" } });
    throw new Error("Approval request has expired");
  }

  // A type that has been removed (an old DATA_EXPORT row) can no longer be applied: close it as expired instead of failing, so the queue clears.
  if (!hasApprovalDefinition(req.actionType)) {
    await prisma.approvalRequest.updateMany({
      where: { id: approvalRequestId, status: "PENDING" },
      data: { status: "EXPIRED", decidedById: actor.id, decidedAt: new Date(), decisionNote: "Request type no longer exists" },
    });
    return;
  }

  const def = getApprovalDefinition(req.actionType as ApprovalActionType);
  if (!(await def.canDecide(actor, { entity: req.entity, entityId: req.entityId }))) throw new Error("Not authorized to decide this request");
  if (req.requestedById === actor.id) throw new Error("Maker cannot also be checker of their own request");
  // Before anything is recorded: a blocked approval leaves the request exactly as it was.
  if (decision === "APPROVED" && def.precheck) await def.precheck(req.payload, { actor, options });

  // Claims the request via a conditional update (WHERE status still PENDING) — this is the
  // concurrency-safe mutex against two simultaneous decisions, so it stays a short, fast
  // operation. def.apply() below can be an arbitrarily complex side effect (e.g. a full stage
  // transition with its own several queries) and must NOT run inside a transaction with a fixed
  // timeout — an earlier version wrapped both in one $transaction and a real stage-correction
  // approval blew past Prisma's 5-second interactive-transaction timeout (P2028), confirmed via
  // manual testing, not just theorized.
  const claimed = await prisma.approvalRequest.updateMany({
    where: { id: approvalRequestId, status: "PENDING" },
    data: { status: decision, decidedById: actor.id, decidedAt: new Date(), decisionNote },
  });
  if (claimed.count === 0) throw new Error(`Approval request already ${decision === "APPROVED" ? "decided" : req.status}`);

  if (decision === "APPROVED") {
    await def.apply(req.payload, { approvalRequestId, decidedById: actor.id });
    await prisma.approvalRequest.update({ where: { id: approvalRequestId }, data: { appliedAt: new Date() } });
  }
}
