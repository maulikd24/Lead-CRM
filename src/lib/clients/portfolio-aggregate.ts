import { prisma } from "@/lib/db/prisma";
import { latestPositionPerHolding } from "@/lib/households/latest-positions";
import { computeAssetAllocation, type PositionForAnalytics } from "@/lib/wealth/portfolio-analytics";

/**
 * The only portfolio view the customer page gets: the name, the total AUM, the asset-class mix as percentages and the last trading
 * date. No product, quantity, price, account number or trade row is ever part of this shape, so no role can be shown one through it.
 */
export type PortfolioSummary = {
  name: string;
  totalAum: number;
  asOf: string | null;
  mix: { bucket: string; pct: number }[];
  lastTradingDate: string | null;
};

type PositionRow = PositionForAnalytics & { asOfDate: Date };

/** Pure: rows in, aggregates out. The rows are reduced to the latest snapshot per holding first, and then dropped. */
export function summarisePortfolio(input: { name: string; positions: PositionRow[]; lastTradingDate: Date | null }): PortfolioSummary {
  const latest = latestPositionPerHolding(input.positions);
  const allocation = computeAssetAllocation(latest).filter((row) => row.value > 0);
  const asOf = latest.reduce<Date | null>((d, p) => (!d || p.asOfDate > d ? p.asOfDate : d), null);
  return {
    name: input.name,
    totalAum: latest.reduce((sum, p) => sum + (p.currentValue ?? 0), 0),
    asOf: asOf?.toISOString() ?? null,
    mix: allocation.map((row) => ({ bucket: row.bucket, pct: row.pct })),
    lastTradingDate: input.lastTradingDate?.toISOString() ?? null,
  };
}

export const loadPortfolioSummary = (clientId: string, name: string) => loadPortfolioSummaryForClients([clientId], name);

/** The same aggregate over several customers (a household): still only the name, total AUM, asset-class mix and last trading date. */
export async function loadPortfolioSummaryForClients(clientIds: string[], name: string): Promise<PortfolioSummary> {
  if (clientIds.length === 0) return summarisePortfolio({ name, positions: [], lastTradingDate: null });
  const [positions, lastTrade] = await Promise.all([
    prisma.position.findMany({
      where: { tradingAccount: { clientId: { in: clientIds } } },
      select: { productId: true, tradingAccountId: true, asOfDate: true, currentValue: true, product: { select: { name: true, category: true } } },
    }),
    prisma.transaction.aggregate({ where: { tradingAccount: { clientId: { in: clientIds } } }, _max: { transactionDate: true } }),
  ]);
  return summarisePortfolio({
    name,
    positions: positions.map((p) => ({ ...p, currentValue: p.currentValue === null ? null : Number(p.currentValue) })),
    lastTradingDate: lastTrade._max.transactionDate,
  });
}
