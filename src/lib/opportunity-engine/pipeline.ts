import type { OpportunityStage } from "@/generated/prisma/client";

export const OPPORTUNITY_STAGE_ORDER: OpportunityStage[] = [
  "IDENTIFIED",
  "DISCUSSED",
  "INTERESTED",
  "RECOMMENDATION",
  "DECISION_PENDING",
  "COMMITTED",
  "FUNDED",
  "INVESTED",
  "LOST_DEFERRED",
];

export type OpportunityPipelineRow = { stage: OpportunityStage; count: number; totalValue: number; totalAum: number };

/**
 * Pure aggregation, no Prisma calls — same "pre-fetch rows, pure function" precedent as
 * computeRmPerformance/computeStageAging. Callers re-run this on read whenever an opportunity
 * transitions stages rather than maintaining a cached total that could drift out of sync.
 */
export function computeOpportunityPipeline(
  opportunities: { stage: OpportunityStage; estimatedValue: number; estimatedAum?: number | null }[],
): OpportunityPipelineRow[] {
  return OPPORTUNITY_STAGE_ORDER.map((stage) => {
    const rows = opportunities.filter((o) => o.stage === stage);
    return {
      stage,
      count: rows.length,
      totalValue: rows.reduce((sum, o) => sum + o.estimatedValue, 0),
      totalAum: rows.reduce((sum, o) => sum + (o.estimatedAum ?? 0), 0),
    };
  });
}
