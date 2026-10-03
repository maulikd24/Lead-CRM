import { computeAssetAllocation, type AssetAllocationRow, type PositionForAnalytics } from "@/lib/wealth/portfolio-analytics";

// Pure computation for the client Overview "at a glance" cards — callers pre-fetch rows (same
// "rows in, numbers out" precedent as computeRmPerformance / portfolio-analytics), nothing here touches Prisma.

export type TradeRow = {
  id: string;
  date: Date;
  type: string;
  productName: string | null;
  quantity: number | null;
  price: number | null;
  amount: number;
  accountNumber: string;
};

export type PaymentRow = {
  id: string;
  paidAt: Date;
  type: string;
  amount: number;
  mode: string | null;
  referenceNumber: string | null;
  status: string;
  accountNumber: string | null;
};

export type PaymentTotals = { fundsIn: number; fundsOut: number; fees: number; lastSyncedAt: Date | null };

export type ClientSnapshot = {
  aum: {
    total: number;
    asOf: Date | null;
    holdingsCount: number;
    accountsCount: number;
    allocation: AssetAllocationRow[];
    /** Σ estimatedAum of open opportunities — potential, not yet invested. */
    pipelineEstimatedAum: number;
  };
  funds: {
    added: boolean;
    amount: number | null;
    status: string | null;
    date: Date | null;
    /** Σ successful FUNDS_IN payments, when any are on file. */
    paymentsReceived: number | null;
  };
  lastTrade: {
    trade: TradeRow | null;
    tradesLast30Days: number;
    lastSyncedAt: Date | null;
  };
};

type LatestPosition = PositionForAnalytics & { asOfDate: Date };

const CLOSED_OPPORTUNITY_STAGES = new Set(["INVESTED", "LOST_DEFERRED"]);

export function computeClientSnapshot(input: {
  /** Already reduced to the latest snapshot per holding (latestPositionPerHolding). */
  latestPositions: LatestPosition[];
  opportunities: { stage: string; estimatedAum: number | null }[];
  fundingRecord: { status: string; amount: number | null; fundingDate: Date | null } | null;
  recentTrades: TradeRow[];
  tradesLast30Days: number;
  tradesLastSyncedAt: Date | null;
  paymentTotals: PaymentTotals;
}): ClientSnapshot {
  const { latestPositions, fundingRecord, paymentTotals } = input;

  const total = latestPositions.reduce((sum, p) => sum + (p.currentValue ?? 0), 0);
  const asOf = latestPositions.reduce<Date | null>((latest, p) => (!latest || p.asOfDate > latest ? p.asOfDate : latest), null);
  const funded = fundingRecord?.status === "PARTIALLY_FUNDED" || fundingRecord?.status === "FULLY_FUNDED";

  return {
    aum: {
      total,
      asOf,
      holdingsCount: latestPositions.length,
      accountsCount: new Set(latestPositions.map((p) => p.tradingAccountId)).size,
      allocation: computeAssetAllocation(latestPositions).filter((row) => row.value > 0),
      pipelineEstimatedAum: input.opportunities
        .filter((o) => !CLOSED_OPPORTUNITY_STAGES.has(o.stage))
        .reduce((sum, o) => sum + (o.estimatedAum ?? 0), 0),
    },
    funds: {
      // Back-office payments are evidence of funds too — a client with money received is "funded" even if the RM never updated the funding form.
      added: funded || (fundingRecord?.amount ?? 0) > 0 || paymentTotals.fundsIn > 0,
      amount: fundingRecord?.amount ?? null,
      status: fundingRecord?.status ?? null,
      date: fundingRecord?.fundingDate ?? null,
      paymentsReceived: paymentTotals.fundsIn > 0 ? paymentTotals.fundsIn : null,
    },
    lastTrade: {
      trade: input.recentTrades[0] ?? null,
      tradesLast30Days: input.tradesLast30Days,
      lastSyncedAt: input.tradesLastSyncedAt,
    },
  };
}
