import { cache } from "react";

import { prisma } from "@/lib/db/prisma";
import { latestPositionPerHolding } from "@/lib/households/latest-positions";
import { getIntelligenceView, type IntelligenceView } from "@/lib/intelligence/view";
import { computeAssetAllocation, computeConcentrationRisk } from "@/lib/wealth/portfolio-analytics";

import { buildAcceptanceChips, buildCallouts } from "./acceptance";
import { buildConsentStatus } from "./consent";
import { buildKeyDates } from "./key-dates";
import { fromActivity, fromJourneyRun, fromMessage, fromOutcome, fromProposal, fromTransaction, mergeTimeline } from "./timeline";

// Every loader takes a clientId that the page has ALREADY authorised (same visibility rule as the client detail page,
// see canViewClient). They are not reachable any other way, so this file adds no data path of its own.
// Each source is one bounded query run in parallel: no per-row queries.

const SOURCE_CAP = 100;

export async function loadTimeline(clientId: string) {
  const [activities, messages, outcomes, proposals, runs, transactions] = await Promise.all([
    prisma.activity.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      take: SOURCE_CAP,
      select: { id: true, type: true, payload: true, createdAt: true, user: { select: { name: true } }, deviceCall: { select: { direction: true, durationSeconds: true } } },
    }),
    prisma.message.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: SOURCE_CAP, select: { id: true, channel: true, direction: true, body: true, status: true, createdAt: true } }),
    prisma.interactionOutcome.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, outcome: true, channel: true, assetClass: true, note: true, summary: true, createdAt: true } }),
    prisma.agentProposal.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, status: true, channel: true, body: true, reason: true, createdAt: true } }),
    prisma.journeyRun.findMany({ where: { clientId }, orderBy: { startedAt: "desc" }, take: 20, select: { id: true, status: true, startedAt: true, journey: { select: { name: true } } } }),
    prisma.transaction.findMany({ where: { tradingAccount: { clientId } }, orderBy: { transactionDate: "desc" }, take: 30, select: { id: true, transactionType: true, transactionDate: true, grossAmount: true, product: { select: { name: true } } } }),
  ]);

  return mergeTimeline([
    activities.map((a) => fromActivity({ id: a.id, type: a.type, payload: a.payload, createdAt: a.createdAt, userName: a.user?.name ?? null, call: a.deviceCall })),
    messages.map(fromMessage),
    outcomes.map(fromOutcome),
    proposals.map(fromProposal),
    runs.map((r) => fromJourneyRun({ id: r.id, journeyName: r.journey.name, status: r.status, startedAt: r.startedAt })),
    transactions.map((t) => fromTransaction({ id: t.id, type: t.transactionType, productName: t.product?.name ?? null, amount: Number(t.grossAmount), date: t.transactionDate })),
  ]);
}

/** One intelligence computation per request, shared by every rail that needs it. */
export const getIntel = cache(async (clientId: string): Promise<IntelligenceView | null> =>
  getIntelligenceView(clientId).catch((error) => {
    console.error("Customer 360: intelligence failed", error instanceof Error ? error.name : "unknown");
    return null;
  }),
);

export async function loadLeftRail(clientId: string) {
  const [positions, intel] = await Promise.all([
    prisma.position.findMany({ where: { tradingAccount: { clientId } }, select: { productId: true, tradingAccountId: true, asOfDate: true, currentValue: true, product: { select: { name: true, category: true } } } }),
    getIntel(clientId),
  ]);
  const latest = latestPositionPerHolding(positions);
  const analytic = latest.map((p) => ({ productId: p.productId, tradingAccountId: p.tradingAccountId, currentValue: p.currentValue === null ? null : Number(p.currentValue), product: p.product }));
  const allocation = computeAssetAllocation(analytic);
  const aum = allocation.reduce((s, r) => s + r.value, 0);
  const asOf = latest.reduce<Date | null>((max, p) => (!max || p.asOfDate > max ? p.asOfDate : max), null);
  const concentration = aum > 0 ? computeConcentrationRisk(allocation) : null;

  return {
    aum,
    asOfIso: asOf?.toISOString() ?? null,
    holdingCount: latest.length,
    allocation: allocation.filter((r) => r.value > 0).map((r) => ({ label: r.bucket, value: r.value })),
    callouts: buildCallouts({ concentration, idleCash: intel?.estimates.idleCash ?? null, externalPortfolio: intel?.estimates.externalPortfolio ?? null }),
    chips: intel ? buildAcceptanceChips(intel.acceptance) : null,
  };
}

export async function loadRightRail(clientId: string, now: Date) {
  const [client, funds, firstTxn, intel] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { createdAt: true, marketingConsentAt: true, marketingConsentText: true, kycRecord: { select: { status: true, completionDate: true, updatedAt: true } }, fundingRecord: { select: { status: true, fundingDate: true } } } }),
    prisma.clientPayment.aggregate({ where: { clientId, paymentType: "FUNDS_IN", status: "SUCCESS" }, _min: { paidAt: true } }),
    prisma.transaction.aggregate({ where: { tradingAccount: { clientId } }, _min: { transactionDate: true } }),
    getIntel(clientId),
  ]);
  if (!client) return null;

  const kycApproved = client.kycRecord?.status === "APPROVED";
  const keyDates = buildKeyDates(
    {
      signedUpAt: client.createdAt,
      kycCompletedAt: kycApproved ? (client.kycRecord?.completionDate ?? client.kycRecord?.updatedAt ?? null) : null,
      firstFundedAt: funds._min.paidAt ?? (client.fundingRecord && ["FULLY_FUNDED", "PARTIALLY_FUNDED"].includes(client.fundingRecord.status) ? client.fundingRecord.fundingDate : null),
      firstTransactionAt: firstTxn._min.transactionDate,
    },
    now,
  );

  return {
    nba: intel?.nba ?? null,
    commitments: intel?.commitments ?? [],
    issues: intel?.issues ?? [],
    keyDates,
    consent: buildConsentStatus({ marketingConsentAt: client.marketingConsentAt, marketingConsentText: client.marketingConsentText, openIssueCount: intel?.issues.length ?? 0, nbaProgramme: intel?.nba.programme ?? null }),
    intelligenceAvailable: intel !== null,
  };
}
