/**
 * Price table for the ESTIMATED cost shown on the agent insights page. This is the only place prices live.
 *
 * These are ASSUMED list prices in US dollars per million tokens, written down by hand, and they will go stale.
 * Treat every figure derived from them as an estimate and check the provider's current price page before relying on
 * it. A model id that is not listed here is shown as "n/a" rather than guessed.
 */
export type ModelPrice = { inputPerMTok: number; outputPerMTok: number };

export const PRICE_TABLE_AS_OF = "2026-10-01 (assumed list prices, not billing data)";

export const PRICE_TABLE: Record<string, ModelPrice> = {
  "claude-sonnet-5-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "gpt-4o-mini": { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  // The in-process test double never calls a vendor.
  fake: { inputPerMTok: 0, outputPerMTok: 0 },
};

function priceFor(model: string): ModelPrice | null {
  if (!model) return null;
  if (PRICE_TABLE[model]) return PRICE_TABLE[model];
  // A dated id such as "<base>-20261001" prices like its base id. Longest base wins.
  const base = Object.keys(PRICE_TABLE)
    .filter((k) => model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  return base ? PRICE_TABLE[base] : null;
}

/** Estimated dollars for one usage figure, or null when the model is not in the table. */
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = priceFor(model);
  if (!p) return null;
  return (inputTokens / 1_000_000) * p.inputPerMTok + (outputTokens / 1_000_000) * p.outputPerMTok;
}

export type UsageRow = { model: string; inputTokens: number; outputTokens: number };
export type UsageCost = { usd: number | null; partial: boolean; unknownModels: string[] };

/**
 * Sums the estimate over many rows. `usd` is null when tokens were used but NO model could be priced. `partial` is true
 * when some (not all) usage could not be priced, so the figure is a lower bound.
 */
export function estimateUsageCost(rows: UsageRow[]): UsageCost {
  let usd = 0;
  let priced = 0;
  const unknown = new Set<string>();
  for (const r of rows) {
    if (r.inputTokens === 0 && r.outputTokens === 0) continue;
    const c = estimateCostUsd(r.model, r.inputTokens, r.outputTokens);
    if (c === null) unknown.add(r.model || "(none)");
    else {
      usd += c;
      priced++;
    }
  }
  if (unknown.size > 0 && priced === 0) return { usd: null, partial: false, unknownModels: [...unknown].sort() };
  return { usd, partial: unknown.size > 0, unknownModels: [...unknown].sort() };
}

export function formatUsd(value: number | null): string {
  if (value === null) return "n/a";
  if (value === 0) return "$0.00";
  return value < 1 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`;
}
