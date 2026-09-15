import { prisma } from "@/lib/db/prisma";
import { registerApproval } from "../registry";

type CommissionAdjustmentPayload = { partnerProfileId: string; payoutId: string; amount: number; reason: string };

registerApproval<CommissionAdjustmentPayload>({
  actionType: "COMMISSION_ADJUSTMENT",
  entity: "Payout",
  canRequest: (actor) => actor.role === "FINANCE" || actor.role === "ADMIN",
  canDecide: (actor) => actor.role === "ADMIN",
  apply: async (payload, ctx) => {
    await prisma.$transaction(async (tx) => {
      await tx.commissionAdjustment.create({
        data: {
          partnerProfileId: payload.partnerProfileId,
          payoutId: payload.payoutId,
          amount: payload.amount,
          reason: payload.reason,
          approvalRequestId: ctx.approvalRequestId,
          createdById: ctx.decidedById,
        },
      });
      const payout = await tx.payout.findUniqueOrThrow({ where: { id: payload.payoutId } });
      const newAdjustmentAmount = Number(payout.adjustmentAmount) + payload.amount;
      await tx.payout.update({
        where: { id: payload.payoutId },
        data: {
          adjustmentAmount: newAdjustmentAmount,
          netPayableAmount: Number(payout.totalAccrualAmount) + newAdjustmentAmount,
        },
      });
    });
  },
});
