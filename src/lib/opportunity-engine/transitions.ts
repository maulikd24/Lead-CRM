import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/activities/log-activity";
import type { OpportunityProduct, OpportunityStage } from "@/generated/prisma/client";

/**
 * A separate, deliberately non-shared engine from src/lib/stage-engine/* — the onboarding pipeline
 * is sequential-only (advance by exactly +1) with a single currentStageId scalar per client;
 * Opportunities allow many concurrent records per client across products and can move to
 * LOST_DEFERRED from any stage, so the two pipelines' transition rules genuinely differ.
 */
export async function createOpportunity(input: {
  clientId: string;
  product: OpportunityProduct;
  estimatedValue: number;
  ownerId: string;
  actorId: string;
}) {
  const opportunity = await prisma.$transaction(async (tx) => {
    const created = await tx.opportunity.create({
      data: {
        clientId: input.clientId,
        product: input.product,
        estimatedValue: input.estimatedValue,
        ownerId: input.ownerId,
      },
    });
    await tx.opportunityStageHistory.create({
      data: { opportunityId: created.id, toStage: "IDENTIFIED", changedById: input.actorId },
    });
    return created;
  });

  await logActivity({
    clientId: input.clientId,
    userId: input.actorId,
    type: "NOTE",
    payload: { message: `Opportunity identified: ${input.product.replace(/_/g, " ")} (₹${input.estimatedValue.toLocaleString("en-IN")})` },
  });

  return opportunity;
}

export async function changeOpportunityStage(input: {
  opportunityId: string;
  toStage: OpportunityStage;
  actorId: string;
  reason?: string;
}) {
  const opportunity = await prisma.opportunity.findUniqueOrThrow({ where: { id: input.opportunityId } });

  if (input.toStage === "LOST_DEFERRED" && !input.reason) {
    throw new Error("A reason is required when moving an opportunity to Lost/Deferred");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.opportunity.update({
      where: { id: input.opportunityId },
      data: {
        stage: input.toStage,
        stageEnteredAt: new Date(),
        lostReason: input.toStage === "LOST_DEFERRED" ? input.reason : null,
      },
    });
    await tx.opportunityStageHistory.create({
      data: {
        opportunityId: input.opportunityId,
        fromStage: opportunity.stage,
        toStage: input.toStage,
        changedById: input.actorId,
        reason: input.reason,
      },
    });
    return next;
  });

  await logActivity({
    clientId: opportunity.clientId,
    userId: input.actorId,
    type: "NOTE",
    payload: {
      message: `Opportunity (${opportunity.product.replace(/_/g, " ")}) moved to ${input.toStage.replace(/_/g, " ")}`,
    },
  });

  return updated;
}
