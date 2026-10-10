import { computeGoalProgress, type GoalProgress } from "./progress";

/** A current holding (latest snapshot) as the goals see it. */
export type HoldingRef = { accountId: string; productId: string; name: string; category: string; value: number };

export type GoalRecord = {
  id: string;
  name: string;
  targetAmount: number;
  targetDate: Date;
  priority: string;
  status: string;
  annualRatePct: number | null;
  plannedMonthly: number | null;
  notes: string | null;
  linkedAccountIds: string[];
  linkedHoldingKeys: string[];
};

export type GoalView = GoalRecord & { progress: GoalProgress; linkedCount: number; hasLinks: boolean; linked: HoldingRef[] };

/** The holdings a goal points at: whole linked accounts plus single linked holdings, each counted once. Nothing is linked by default. */
export function holdingsLinkedTo(goal: Pick<GoalRecord, "linkedAccountIds" | "linkedHoldingKeys">, holdings: readonly HoldingRef[]): HoldingRef[] {
  const accounts = new Set(goal.linkedAccountIds);
  const keys = new Set(goal.linkedHoldingKeys);
  return holdings.filter((h) => accounts.has(h.accountId) || keys.has(`${h.accountId}:${h.productId}`));
}

export function buildGoalView(goal: GoalRecord, holdings: readonly HoldingRef[], asOf: Date): GoalView {
  const linked = holdingsLinkedTo(goal, holdings);
  const progress = computeGoalProgress({
    targetAmount: goal.targetAmount,
    targetDate: goal.targetDate,
    currentValue: linked.reduce((sum, h) => sum + h.value, 0),
    plannedMonthly: goal.plannedMonthly,
    annualRatePct: goal.annualRatePct,
    asOf,
  });
  return { ...goal, progress, linked, linkedCount: linked.length, hasLinks: goal.linkedAccountIds.length + goal.linkedHoldingKeys.length > 0 };
}
