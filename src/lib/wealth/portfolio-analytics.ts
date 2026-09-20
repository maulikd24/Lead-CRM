import type { ProductCategory } from "@/generated/prisma/client";

/**
 * Pure computation over already-fetched, already-deduplicated positions (run them through
 * latestPositionPerHolding() first — src/lib/households/latest-positions.ts — the same rule
 * Households already established: AUM/allocation must only ever count the latest snapshot per
 * holding, never sum every historical batch-feed row). No Prisma calls here, same "pre-fetch
 * rows, pure function" precedent as computeRmPerformance/computeStageAging.
 */

export type PositionForAnalytics = {
  productId: string;
  tradingAccountId: string;
  currentValue: number | null;
  product: { name: string; category: ProductCategory };
};

const CATEGORY_BUCKET: Record<ProductCategory, string> = {
  EQUITY: "Equity",
  MUTUAL_FUND: "Mutual Fund",
  PMS: "PMS",
  BOND: "Fixed Income",
  FIXED_DEPOSIT: "Fixed Income",
  INSURANCE: "Insurance",
  NPS: "Other",
  AIF: "Other",
  OTHER: "Other",
};

export const ASSET_BUCKETS = ["Equity", "Mutual Fund", "PMS", "Fixed Income", "Insurance", "Other"] as const;

export type AssetAllocationRow = { bucket: string; value: number; pct: number };

export function computeAssetAllocation(positions: PositionForAnalytics[]): AssetAllocationRow[] {
  const totals = new Map<string, number>(ASSET_BUCKETS.map((b) => [b, 0]));
  let total = 0;
  for (const position of positions) {
    const value = position.currentValue ?? 0;
    const bucket = CATEGORY_BUCKET[position.product.category];
    totals.set(bucket, (totals.get(bucket) ?? 0) + value);
    total += value;
  }
  return ASSET_BUCKETS.map((bucket) => {
    const value = totals.get(bucket) ?? 0;
    return { bucket, value, pct: total > 0 ? Math.round((value / total) * 1000) / 10 : 0 };
  });
}

export type ConcentrationRisk = { hhi: number; label: "Diversified" | "Moderate" | "Concentrated" };

/**
 * Herfindahl-Hirschman Index over asset-bucket weights (0-1 scale: sum of squared fractional
 * shares). A starting heuristic, not a regulatory-grade risk model — thresholds follow the common
 * HHI convention (<0.15 diversified, 0.15-0.25 moderate, >0.25 concentrated) applied to asset-class
 * mix here rather than market-share; worth revisiting with an advisor once this is used for real.
 */
export function computeConcentrationRisk(allocation: AssetAllocationRow[]): ConcentrationRisk {
  const hhi = allocation.reduce((sum, row) => sum + (row.pct / 100) ** 2, 0);
  const label = hhi > 0.25 ? "Concentrated" : hhi > 0.15 ? "Moderate" : "Diversified";
  return { hhi: Math.round(hhi * 1000) / 1000, label };
}

export type HoldingDuplicationRow = { productId: string; productName: string; accountCount: number };

/** Same product held via more than one Trading Account for this client — worth a look, not
 * necessarily a problem (e.g. deliberate SIPs in separate accounts), so surfaced as information. */
export function computeHoldingDuplication(positions: PositionForAnalytics[]): HoldingDuplicationRow[] {
  const accountsByProduct = new Map<string, { name: string; accounts: Set<string> }>();
  for (const position of positions) {
    const entry = accountsByProduct.get(position.productId) ?? { name: position.product.name, accounts: new Set<string>() };
    entry.accounts.add(position.tradingAccountId);
    accountsByProduct.set(position.productId, entry);
  }
  return Array.from(accountsByProduct.entries())
    .filter(([, entry]) => entry.accounts.size > 1)
    .map(([productId, entry]) => ({ productId, productName: entry.name, accountCount: entry.accounts.size }));
}

export type RiskAlignment = {
  growthPct: number | null;
  expectedRange: [number, number] | null;
  aligned: boolean | null;
  message: string;
};

const RISK_BANDS: Record<string, [number, number]> = {
  Conservative: [0, 30],
  Moderate: [30, 65],
  Aggressive: [65, 100],
};

/**
 * "Growth" assets (Equity/Mutual Fund/PMS) vs "defensive" assets (Fixed Income/Insurance) —
 * Other is excluded from the ratio since it doesn't cleanly sort into either bucket. Compares the
 * growth share against a band per SmartAllvestProfile.investorRiskProfile. A starting heuristic
 * (see computeConcentrationRisk's note) — bands are illustrative, not compliance-reviewed.
 */
export function computeRiskAlignment(riskProfile: string | null, allocation: AssetAllocationRow[]): RiskAlignment {
  const byBucket = new Map(allocation.map((row) => [row.bucket, row.value]));
  const growth = (byBucket.get("Equity") ?? 0) + (byBucket.get("Mutual Fund") ?? 0) + (byBucket.get("PMS") ?? 0);
  const defensive = (byBucket.get("Fixed Income") ?? 0) + (byBucket.get("Insurance") ?? 0);
  const denom = growth + defensive;
  const growthPct = denom > 0 ? Math.round((growth / denom) * 1000) / 10 : null;

  if (!riskProfile) {
    return { growthPct, expectedRange: null, aligned: null, message: "Set a risk profile via Smart Allvest to check alignment." };
  }
  const band = RISK_BANDS[riskProfile];
  if (!band) {
    return { growthPct, expectedRange: null, aligned: null, message: `Unrecognized risk profile "${riskProfile}".` };
  }
  if (growthPct === null) {
    return { growthPct, expectedRange: band, aligned: null, message: "No growth/defensive holdings yet to compare against the risk profile." };
  }
  const aligned = growthPct >= band[0] && growthPct <= band[1];
  return {
    growthPct,
    expectedRange: band,
    aligned,
    message: aligned
      ? `Growth allocation (${growthPct}%) is within the expected ${band[0]}-${band[1]}% band for ${riskProfile}.`
      : `Growth allocation (${growthPct}%) is outside the expected ${band[0]}-${band[1]}% band for ${riskProfile}.`,
  };
}
