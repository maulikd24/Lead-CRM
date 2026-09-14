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
  return prisma.$transaction(async (tx) => {
    const req = await tx.approvalRequest.findUnique({ where: { id: approvalRequestId } });
    if (!req) throw new Error("Approval request not found");
    if (req.status !== "PENDING") throw new Error(`Approval request already ${req.status}`);

    const def = getApprovalDefinition(req.actionType as ApprovalActionType);
    if (!def.canDecide(actor)) throw new Error("Not authorized to decide this request");
    if (req.requestedById === actor.id) throw new Error("Maker cannot also be checker of their own request");

    await tx.approvalRequest.update({
      where: { id: approvalRequestId },
      data: { status: decision, decidedById: actor.id, decidedAt: new Date(), decisionNote },
    });

    if (decision === "APPROVED") {
      await def.apply(req.payload, { approvalRequestId, decidedById: actor.id });
      await tx.approvalRequest.update({ where: { id: approvalRequestId }, data: { appliedAt: new Date() } });
    }
  });
}
