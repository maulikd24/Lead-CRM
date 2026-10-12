import { cache } from "react";

import { prisma } from "@/lib/db/prisma";
import { latestPositionPerHolding } from "@/lib/households/latest-positions";
import { loadCustomerFacts } from "@/lib/intelligence/facts";
import { computeIntelligence } from "@/lib/intelligence/refresh";
import { toIntelligenceView, type IntelligenceView } from "@/lib/intelligence/view";
import { computeAssetAllocation, computeConcentrationRisk } from "@/lib/wealth/portfolio-analytics";

import { buildAcceptanceChips, buildCallouts } from "./acceptance";
import { buildConsentStatus } from "./consent";
import { buildTicketsView } from "./tickets";
import { buildKeyDates } from "./key-dates";
import { dropMirroredMessageActivities, fromActivity, fromJourneyRun, fromMessage, fromOutcome, fromProposal, fromTransaction, mergeCapped } from "./timeline";

// Every loader takes a clientId that the page has ALREADY authorised (same visibility rule as the client detail page,
// see canViewClient). They are not reachable any other way, so this file adds no data path of its own.
// Each source is one bounded query run in parallel: no per-row queries.

const SOURCE_CAP = 100;
const POSITION_WINDOW_DAYS = 400;

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

  const activityInputs = activities.map((a) => ({ id: a.id, type: a.type, payload: a.payload, createdAt: a.createdAt, userName: a.user?.name ?? null, call: a.deviceCall }));
  // A CRM message is stored as a Message row AND a MESSAGE activity: show it once (the row), keep provider events.
  const activityEvents = dropMirroredMessageActivities(activityInputs, messages).map(fromActivity);

  return mergeCapped([
    { events: activityEvents, capped: activities.length >= SOURCE_CAP },
    { events: messages.map(fromMessage), capped: messages.length >= SOURCE_CAP },
    { events: outcomes.map(fromOutcome), capped: outcomes.length >= 50 },
    { events: proposals.map(fromProposal), capped: proposals.length >= 30 },
    { events: runs.map((r) => fromJourneyRun({ id: r.id, journeyName: r.journey.name, status: r.status, startedAt: r.startedAt })), capped: runs.length >= 20 },
    { events: transactions.map((t) => fromTransaction({ id: t.id, type: t.transactionType, productName: t.product?.name ?? null, amount: Number(t.grossAmount), date: t.transactionDate })), capped: transactions.length >= 30 },
  ]);
}

/**
 * One READ-ONLY intelligence computation per request, shared by every rail that needs it. Unlike the client detail
 * page (which recomputes and persists via refreshCustomerIntelligence), this loads the facts and runs the pure
 * engines: viewing Customer 360 never writes, never syncs segments and never fires a journey. Archived and merged
 * customers have no facts and come back as null.
 */
export const getIntel = cache(async (clientId: string): Promise<IntelligenceView | null> => {
  try {
    const facts = await loadCustomerFacts(clientId);
    return facts ? toIntelligenceView(computeIntelligence(facts)) : null;
  } catch (error) {
    console.error("Customer 360: intelligence failed", error instanceof Error ? error.name : "unknown");
    return null;
  }
});

export async function loadLeftRail(clientId: string) {
  const since = new Date(Date.now() - POSITION_WINDOW_DAYS * 86_400_000);
  const [positions, intel] = await Promise.all([
    // Bounded: only the latest snapshot per holding within the window (newest first, one row per account+product).
    prisma.position.findMany({
      where: { tradingAccount: { clientId }, asOfDate: { gte: since } },
      orderBy: { asOfDate: "desc" },
      distinct: ["tradingAccountId", "productId"],
      select: { productId: true, tradingAccountId: true, asOfDate: true, quantity: true, currentValue: true, product: { select: { name: true, category: true } } },
    }),
    getIntel(clientId),
  ]);
  // A holding sold to zero (the feed sends quantity 0 / closed) is no longer held: hide it.
  const latest = latestPositionPerHolding(positions).filter((p) => Number(p.quantity) > 0);
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
  const [client, funds, firstTxn, intel, ticketRows, ledger] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { createdAt: true, marketingConsentAt: true, marketingConsentText: true, kycRecord: { select: { status: true, completionDate: true, updatedAt: true } }, fundingRecord: { select: { status: true, fundingDate: true } } } }),
    prisma.clientPayment.aggregate({ where: { clientId, paymentType: "FUNDS_IN", status: "SUCCESS" }, _min: { paidAt: true } }),
    prisma.transaction.aggregate({ where: { tradingAccount: { clientId } }, _min: { transactionDate: true } }),
    getIntel(clientId),
    prisma.supportTicket.findMany({ where: { clientId }, orderBy: { ticketCreatedAt: "desc" }, take: 100, select: { id: true, externalId: true, subject: true, status: true, priority: true, channel: true, ticketCreatedAt: true, ticketUpdatedAt: true } }),
    // The consent ledger: the record of what the customer agreed to. Bounded; the newest rows decide.
    prisma.consentRecord.findMany({ where: { clientId }, orderBy: { capturedAt: "desc" }, take: 200, select: { id: true, purpose: true, channel: true, status: true, capturedAt: true, expiresAt: true, source: true, noticeVersion: true } }),
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
    tickets: buildTicketsView(ticketRows),
    consent: buildConsentStatus({ records: ledger, now, marketingConsentAt: client.marketingConsentAt, marketingConsentText: client.marketingConsentText, openIssueCount: intel?.issues.length ?? 0, nbaProgramme: intel?.nba.programme ?? null }),
    intelligenceAvailable: intel !== null,
  };
}
