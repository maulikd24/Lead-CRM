import type { CommissionRateType, ProductCategory, TransactionType } from "@/generated/prisma/client";

export type CommissionSlabInput = {
  minAmount: number;
  maxAmount: number | null;
  rate: number;
};

export type CommissionRuleInput = {
  id: string;
  productCategory: ProductCategory | null;
  transactionType: TransactionType | null;
  rateType: CommissionRateType;
  percentRate: number | null;
  flatRate: number | null;
  validFrom: Date;
  validTo: Date | null;
  slabs: CommissionSlabInput[];
};

export type RevenueEventInput = {
  grossRevenueAmount: number;
  eventDate: Date;
  productCategory: ProductCategory | null;
  transactionType: TransactionType | null;
};

export type AccrualComputation = {
  commissionRuleId: string;
  accrualAmount: number;
};

/** Bump when the rule-matching or rate-computation logic below changes materially — stored on
 * every CommissionAccrual row so a future recompute can tell which rows used which logic. */
export const COMPUTATION_VERSION = "v1";

function isActiveOn(rule: Pick<CommissionRuleInput, "validFrom" | "validTo">, date: Date): boolean {
  if (rule.validFrom > date) return false;
  if (rule.validTo && rule.validTo <= date) return false;
  return true;
}

/** Higher = more specific. A rule matching both productCategory and transactionType outranks one
 * matching only one field, which outranks a catch-all (both null) rule. */
function specificity(rule: CommissionRuleInput): number {
  return (rule.productCategory ? 1 : 0) + (rule.transactionType ? 1 : 0);
}

function matches(rule: CommissionRuleInput, event: RevenueEventInput): boolean {
  if (rule.productCategory && rule.productCategory !== event.productCategory) return false;
  if (rule.transactionType && rule.transactionType !== event.transactionType) return false;
  return true;
}

function rateFromSlabs(slabs: CommissionSlabInput[], grossAmount: number): number | null {
  const slab = slabs.find((s) => s.minAmount <= grossAmount && (s.maxAmount === null || grossAmount < s.maxAmount));
  return slab ? (grossAmount * slab.rate) / 100 : null;
}

/**
 * Pure computation, no Prisma calls — same "callers supply already-fetched, already-scoped rows"
 * precedent as computeRmPerformance (src/lib/reports/rm-performance.ts). Picks the single most
 * specific active CommissionRule for this event and computes the accrual amount for one partner.
 * Returns null when no rule matches — a RevenueEvent with no applicable commission is a legitimate,
 * silent outcome, not an error.
 */
export function computeAccrual(event: RevenueEventInput, rules: CommissionRuleInput[]): AccrualComputation | null {
  const candidates = rules.filter((r) => isActiveOn(r, event.eventDate) && matches(r, event));
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => specificity(b) - specificity(a) || a.id.localeCompare(b.id));
  const rule = candidates[0];

  let accrualAmount: number | null = null;
  switch (rule.rateType as CommissionRateType) {
    case "PERCENT_OF_GROSS":
    case "PERCENT_OF_NET":
      accrualAmount = rule.percentRate !== null ? (event.grossRevenueAmount * rule.percentRate) / 100 : null;
      break;
    case "FLAT_PER_TRANSACTION":
      accrualAmount = rule.flatRate;
      break;
    case "SLAB":
      accrualAmount = rateFromSlabs(rule.slabs, event.grossRevenueAmount);
      break;
  }

  if (accrualAmount === null) return null;
  return { commissionRuleId: rule.id, accrualAmount };
}
