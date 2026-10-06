import { prisma } from "@/lib/db/prisma";
import { getNextBestAction, type NextBestAction } from "@/lib/copilot/next-best-action";
import { hasContactRecord, type CopilotClient } from "@/lib/copilot/types";
import { isReferralLeadSource } from "@/lib/stage-engine/sla-status";
import { latestPositionPerHolding } from "@/lib/households/latest-positions";
import { computeAssetAllocation, computeConcentrationRisk, type AssetAllocationRow, type ConcentrationRisk } from "@/lib/wealth/portfolio-analytics";
import { OPPORTUNITY_ASSET_CLASS, PRODUCT_CATEGORY_ASSET_CLASS, isAssetClass, type AssetClass } from "./constants";

const DAY = 24 * 60 * 60 * 1000;

export type FactsInsight = {
  id: string;
  kind: string;
  assetClass: string | null;
  text: string;
  status: string;
  dueAt: Date | null;
  severity: string | null;
  occurredAt: Date;
  sourceType: string;
};

/**
 * Everything the intelligence engines need about one customer, as plain data — the engines themselves
 * (lifecycle, acceptance, situations, next best action) are pure functions of this, so they can be tested without a database.
 */
export type CustomerFacts = {
  now: Date;
  client: {
    id: string;
    name: string;
    clientCode: string;
    status: string;
    createdAt: Date;
    assignedToId: string | null;
    customerCategory: string | null;
    clientType: string | null;
    investmentCategory: string | null;
    leadSource: string | null;
    productInterest: string | null;
    expectedInvestment: number | null;
    isReferral: boolean;
  };
  stage: { name: string; sequence: number; enteredAt: Date };
  onboarding: NextBestAction;
  hasContacted: boolean;
  kycApproved: boolean;
  funding: { status: string | null; amount: number | null; paymentsIn: number; firstPaymentAt: Date | null };
  portfolio: { aum: number; allocation: AssetAllocationRow[]; concentration: ConcentrationRisk; holds: AssetClass[]; positionCount: number };
  trading: { count: number; first: Date | null; last: Date | null; last90: number; hasSip: boolean };
  wealth: { checkupStatus: string | null; checkupCompletedAt: Date | null; riskProfile: string | null; pmsAifInvested: AssetClass[] };
  opportunities: { assetClass: AssetClass; stage: string; lostReason: string | null; updatedAt: Date }[];
  insights: FactsInsight[];
  manualAcceptance: { assetClass: string; level: "HIGH" | "MEDIUM" | "LOW"; updatedAt: Date }[];
  outcomes: { outcome: string; assetClass: string | null; createdAt: Date }[];
  intel: {
    dematTransferStatus: string | null;
    mfTransferStatus: string | null;
    externalPortfolio: number | null;
    mfTransfer: number | null;
    idleCash: number | null;
  };
  negativeReviewRecent: boolean;
  lastActivityAt: Date | null;
  overdueTasks: number;
};

const num = (value: { toString(): string } | null | undefined): number | null => (value === null || value === undefined ? null : Number(value));

export async function loadCustomerFacts(clientId: string, now = new Date()): Promise<CustomerFacts | null> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, isDeleted: false, mergedIntoId: null },
    include: {
      currentStage: true,
      documents: { select: { documentType: true, mandatory: true, status: true } },
      kycRecord: true,
      fundingRecord: true,
      dealerIntroduction: true,
      activities: { where: { type: "NOTE" }, select: { type: true, payload: true } },
      intelligence: true,
    },
  });
  if (!client) return null;

  const accountFilter = { tradingAccount: { clientId } };
  const [positions, txAgg, txLast90, txSip, payments, checkup, profile, pmsAif, opportunities, insights, acceptances, outcomes, negativeReviews, lastActivity, contactActivities, overdueTasks] = await Promise.all([
    prisma.position.findMany({ where: accountFilter, include: { product: { select: { name: true, category: true } } } }),
    prisma.transaction.aggregate({ where: accountFilter, _count: { _all: true }, _min: { transactionDate: true }, _max: { transactionDate: true } }),
    prisma.transaction.count({ where: { ...accountFilter, transactionDate: { gte: new Date(now.getTime() - 90 * DAY) } } }),
    prisma.transaction.count({ where: { ...accountFilter, transactionType: "SIP" } }),
    prisma.clientPayment.aggregate({ where: { clientId, paymentType: "FUNDS_IN", status: "SUCCESS" }, _sum: { amount: true }, _min: { paidAt: true } }),
    prisma.wealthHealthCheckup.findUnique({ where: { clientId } }),
    prisma.smartAllvestProfile.findUnique({ where: { clientId } }),
    prisma.pmsAifHolding.findMany({ where: { clientId, status: "INVESTED" } }),
    prisma.opportunity.findMany({ where: { clientId }, select: { product: true, stage: true, lostReason: true, updatedAt: true } }),
    prisma.conversationInsight.findMany({
      where: { clientId, OR: [{ status: "OPEN" }, { occurredAt: { gte: new Date(now.getTime() - 180 * DAY) } }] },
      orderBy: { occurredAt: "desc" },
      take: 200,
    }),
    prisma.assetClassAcceptance.findMany({ where: { clientId, isManual: true } }),
    prisma.interactionOutcome.findMany({ where: { clientId, createdAt: { gte: new Date(now.getTime() - 180 * DAY) } }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.conversationReview.count({
      where: { clientId, status: "ANALYZED", analyzedAt: { gte: new Date(now.getTime() - 14 * DAY) }, OR: [{ sentimentLabel: "negative" }, { qualityScore: { lt: 50 } }] },
    }),
    prisma.activity.findFirst({ where: { clientId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.activity.count({ where: { clientId, type: { in: ["CALL", "MESSAGE"] } } }),
    prisma.task.count({ where: { clientId, status: "OVERDUE" } }),
  ]);
  // A promise is kept once its follow-up task is done (by completing it or by logging a note that closes tasks).
  const closedCommitmentTasks = await prisma.task.findMany({ where: { clientId, source: { startsWith: "commitment:" }, status: { in: ["DONE", "CANCELLED"] } }, select: { source: true } });
  const keptCommitments = new Set(closedCommitmentTasks.map((t) => t.source!.slice("commitment:".length)));

  const latest = latestPositionPerHolding(positions);
  const analytic = latest.map((p) => ({
    productId: p.productId,
    tradingAccountId: p.tradingAccountId,
    currentValue: num(p.currentValue),
    product: p.product,
  }));
  const allocation = computeAssetAllocation(analytic);
  const holds = new Set<AssetClass>();
  for (const p of analytic) {
    const assetClass = PRODUCT_CATEGORY_ASSET_CLASS[p.product.category];
    if (assetClass && (p.currentValue ?? 0) > 0) holds.add(assetClass);
  }

  const pmsAifInvested = new Set<AssetClass>();
  for (const holding of pmsAif) pmsAifInvested.add(holding.productName.toUpperCase().startsWith("PMS") ? "PMS" : "AIF");

  const onboarding = getNextBestAction(client as unknown as CopilotClient);
  const intel = client.intelligence;

  return {
    now,
    client: {
      id: client.id,
      name: client.name,
      clientCode: client.clientCode,
      status: client.status,
      createdAt: client.createdAt,
      assignedToId: client.assignedToId,
      customerCategory: client.customerCategory,
      clientType: client.clientType,
      investmentCategory: client.investmentCategory,
      leadSource: client.leadSource,
      productInterest: client.productInterest,
      expectedInvestment: num(client.expectedInvestment),
      isReferral: isReferralLeadSource(client.leadSource),
    },
    stage: { name: client.currentStage.name, sequence: client.currentStage.sequence, enteredAt: client.stageEnteredAt },
    onboarding,
    hasContacted: hasContactRecord(client.activities) || contactActivities > 0,
    kycApproved: client.kycRecord?.status === "APPROVED",
    funding: {
      status: client.fundingRecord?.status ?? null,
      amount: num(client.fundingRecord?.amount),
      paymentsIn: num(payments._sum.amount) ?? 0,
      firstPaymentAt: payments._min.paidAt,
    },
    portfolio: {
      aum: analytic.reduce((sum, p) => sum + (p.currentValue ?? 0), 0),
      allocation,
      concentration: computeConcentrationRisk(allocation),
      holds: [...holds],
      positionCount: latest.length,
    },
    trading: { count: txAgg._count._all, first: txAgg._min.transactionDate, last: txAgg._max.transactionDate, last90: txLast90, hasSip: txSip > 0 },
    wealth: {
      checkupStatus: checkup?.status ?? null,
      checkupCompletedAt: checkup?.completedAt ?? null,
      riskProfile: profile?.investorRiskProfile ?? null,
      pmsAifInvested: [...pmsAifInvested],
    },
    opportunities: opportunities.flatMap((o) => {
      const assetClass = OPPORTUNITY_ASSET_CLASS[o.product];
      return assetClass ? [{ assetClass, stage: o.stage, lostReason: o.lostReason, updatedAt: o.updatedAt }] : [];
    }),
    insights: insights.map((i) => ({ id: i.id, kind: i.kind, assetClass: i.assetClass, text: i.text, status: i.kind === "COMMITMENT" && keptCommitments.has(i.id) ? "DONE" : i.status, dueAt: i.dueAt, severity: i.severity, occurredAt: i.occurredAt, sourceType: i.sourceType })),
    manualAcceptance: acceptances.filter((a) => isAssetClass(a.assetClass)).map((a) => ({ assetClass: a.assetClass, level: a.level, updatedAt: a.updatedAt })),
    outcomes: outcomes.map((o) => ({ outcome: o.outcome, assetClass: o.assetClass, createdAt: o.createdAt })),
    intel: {
      dematTransferStatus: intel?.dematTransferStatus ?? null,
      mfTransferStatus: intel?.mfTransferStatus ?? null,
      externalPortfolio: num(intel?.externalPortfolioEstimate),
      mfTransfer: num(intel?.mfTransferEstimate),
      idleCash: num(intel?.idleCashEstimate),
    },
    negativeReviewRecent: negativeReviews > 0,
    lastActivityAt: lastActivity?.createdAt ?? null,
    overdueTasks,
  };
}
