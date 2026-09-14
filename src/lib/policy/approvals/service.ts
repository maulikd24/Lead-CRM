import { prisma } from "@/lib/db/prisma";
import type { Actor } from "../types";
import { getApprovalDefinition, type ApprovalActionType } from "./registry";

export async function requestApproval(
  actionType: ApprovalActionType,
  input: { entity: string; entityId: string; payload: unknown; reason?: string },
  actor: Actor,
) {
  const def = getApprovalDefinition(actionType);
  if (!def.canRequest(actor)) throw new Error("Not authorized to request this action");
  return prisma.approvalRequest.create({
    data: {
      actionType,
      entity: input.entity,
      entityId: input.entityId,
      payload: input.payload as object,
      reason: input.reason,
      requestedById: actor.id,
    },
  });
}

export async function decideApproval(
  approvalRequestId: string,
  decision: "APPROVED" | "REJECTED",
  decisionNote: string | undefined,
  actor: Actor,
) {
  const req = await prisma.approvalRequest.findUnique({ where: { id: approvalRequestId } });
  if (!req) throw new Error("Approval request not found");
  if (req.status !== "PENDING") throw new Error(`Approval request already ${req.status}`);

  const def = getApprovalDefinition(req.actionType as ApprovalActionType);
  if (!def.canDecide(actor)) throw new Error("Not authorized to decide this request");
  if (req.requestedById === actor.id) throw new Error("Maker cannot also be checker of their own request");

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
