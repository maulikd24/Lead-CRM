/**
 * The autonomy ladder, per (agent, action type). Owner-confirmed ceilings:
 *   - a customer-facing send is L3 (draft) or L4 (execute after a human approves) and nothing else, never automatic;
 *   - an ad spend change is L4 at most;
 *   - L5 (auto-execute) is only for internal, reversible, non-customer actions (for example retrying a failed idempotent sync).
 * Pure and Prisma-free. Every approval definition carries a profile and is checked against these rules when the registry loads.
 */
export const AUTONOMY_LEVELS = ["L0", "L1", "L2", "L3", "L4", "L5"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export type AutonomyProfile = {
  level: AutonomyLevel;
  /** Text or content that reaches a customer or the public. */
  customerFacing: boolean;
  /** Changes how much money is spent on advertising. */
  adSpend: boolean;
  /** Stays inside the company and can be undone. */
  internalReversible: boolean;
};

export const levelRank = (l: AutonomyLevel) => AUTONOMY_LEVELS.indexOf(l);

export function autonomyViolations(p: AutonomyProfile): string[] {
  const v: string[] = [];
  if (p.customerFacing && p.level !== "L3" && p.level !== "L4") v.push(`customer-facing actions are L3 or L4 only, not ${p.level}`);
  if (p.adSpend && levelRank(p.level) > levelRank("L4")) v.push(`ad spend changes are L4 at most, not ${p.level}`);
  if (p.level === "L5" && !(p.internalReversible && !p.customerFacing && !p.adSpend)) v.push("L5 is only for internal, reversible, non-customer, non-spend actions");
  return v;
}

export function assertAutonomy(kind: string, p: AutonomyProfile): void {
  const v = autonomyViolations(p);
  if (v.length) throw new Error(`Approval kind "${kind}": ${v.join("; ")}`);
}
