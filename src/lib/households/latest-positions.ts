import type { Position } from "@/generated/prisma/client";

/**
 * A batch feed (or repeated CSV import) can leave many historical Position snapshots per
 * (tradingAccountId, productId) — one per asOfDate. AUM must only ever count the LATEST snapshot
 * per holding, never sum every historical row, or it silently inflates every time new data lands.
 * Single source of truth for that dedup, shared by the Households list page and the Household 360
 * detail page so they can never disagree.
 */
export function latestPositionPerHolding<T extends Pick<Position, "productId" | "tradingAccountId" | "asOfDate">>(
  positions: T[],
): T[] {
  const latestByHolding = new Map<string, T>();
  for (const position of positions) {
    const key = `${position.tradingAccountId}:${position.productId}`;
    const existing = latestByHolding.get(key);
    if (!existing || position.asOfDate > existing.asOfDate) latestByHolding.set(key, position);
  }
  return Array.from(latestByHolding.values());
}
