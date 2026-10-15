import { computeGoalProgress, type GoalProgress } from "./progress";

/** A current holding (latest snapshot) as the goals see it. Server-side only: it never leaves the server (DPDP data minimisation). */
export type HoldingRef = { accountId: string; productId: string; name: string; category: string; value: number };

/** Goals link to a coarse asset class, never to a single holding or account. */
export const ASSET_CLASSES = [
  { key: "equity", label: "Equity" },
  { key: "mutual_fund", label: "Mutual funds" },
  { key: "bonds", label: "Bonds" },
  { key: "other", label: "Other" },
] as const;
export type AssetClassKey = (typeof ASSET_CLASSES)[number]["key"];
const CLASS_KEYS: readonly string[] = ASSET_CLASSES.map((c) => c.key);
export const isAssetClassKey = (k: unknown): k is AssetClassKey => typeof k === "string" && CLASS_KEYS.includes(k);
export const classLabel = (k: AssetClassKey) => ASSET_CLASSES.find((c) => c.key === k)!.label;

export function assetClassOf(category: string): AssetClassKey {
  if (category === "EQUITY") return "equity";
  if (category === "MUTUAL_FUND") return "mutual_fund";
  if (category === "BOND" || category === "FIXED_DEPOSIT") return "bonds";
  return "other";
}

/** Class links are stored in the existing linkedHoldingKeys column as "class:<key>" (no schema change). */
export const CLASS_PREFIX = "class:";
export const toStoredClassKeys = (keys: readonly string[]) => keys.map((k) => `${CLASS_PREFIX}${k}`);

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

export type GoalView = GoalRecord & { progress: GoalProgress; linkedCount: number; hasLinks: boolean; linkedClasses: { key: AssetClassKey; value: number }[] };

/**
 * The asset classes a goal points at. Stored class links are read as they are; legacy links to a whole account or a single holding
 * (accountId or "accountId:productId") are mapped, at read time and without rewriting anything, to the classes held there.
 * Shortcut: the mapping widens the goal to the whole class; the old per-holding precision is gone by design.
 */
export function linkedClassKeys(goal: Pick<GoalRecord, "linkedAccountIds" | "linkedHoldingKeys">, holdings: readonly HoldingRef[]): AssetClassKey[] {
  const accounts = new Set(goal.linkedAccountIds);
  const legacy = new Set(goal.linkedHoldingKeys.filter((k) => !k.startsWith(CLASS_PREFIX)));
  const out = new Set<string>(goal.linkedHoldingKeys.filter((k) => k.startsWith(CLASS_PREFIX)).map((k) => k.slice(CLASS_PREFIX.length)).filter(isAssetClassKey));
  for (const h of holdings) if (accounts.has(h.accountId) || legacy.has(`${h.accountId}:${h.productId}`)) out.add(assetClassOf(h.category));
  return ASSET_CLASSES.map((c) => c.key).filter((k) => out.has(k));
}

export function buildGoalView(goal: GoalRecord, holdings: readonly HoldingRef[], asOf: Date): GoalView {
  const keys = linkedClassKeys(goal, holdings);
  const linkedClasses = keys.map((key) => ({ key, value: holdings.filter((h) => assetClassOf(h.category) === key).reduce((s, h) => s + h.value, 0) }));
  const progress = computeGoalProgress({
    targetAmount: goal.targetAmount,
    targetDate: goal.targetDate,
    currentValue: linkedClasses.reduce((sum, c) => sum + c.value, 0),
    plannedMonthly: goal.plannedMonthly,
    annualRatePct: goal.annualRatePct,
    asOf,
  });
  return { ...goal, progress, linkedClasses, linkedCount: keys.length, hasLinks: goal.linkedAccountIds.length + goal.linkedHoldingKeys.length > 0 };
}
