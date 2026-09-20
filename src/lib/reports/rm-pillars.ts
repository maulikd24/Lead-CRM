import { prisma } from "@/lib/db/prisma";

export type RmPillars = {
  activity: {
    clientsContacted: number;
    meetingsCompleted: number;
    followUpsCompleted: number;
    followUpCompletionRate: number; // 0-100, done vs. (done + currently overdue)
  };
  journey: {
    kycCompletionRate: number; // 0-100, of this RM's Active/Completed clients
    wealthHealthCheckupCompletionRate: number;
    smartAllvestCompletionRate: number;
  };
  business: {
    fundsReceived: number;
    investmentsExecuted: number;
    netAumAdded: number; // sum of estimatedValue for this RM's Opportunities that entered INVESTED within the period
    productPenetrationRate: number; // 0-100, of this RM's Active/Completed clients with >=1 Trading Account
  };
};

/**
 * Module 5 of the RM/Wealth CRM spec: the 4-pillar restructure of RM performance. Relationship
 * Quality (Client Engagement Score, NPS, Service Issue Closure Time) is deliberately not computed
 * here — it needs a real data-collection mechanism (e.g. an NPS survey flow) that doesn't exist
 * yet; the RM drill-down page renders an explicit placeholder for that pillar instead of a fake
 * number. Everything else here is genuinely computable from existing Module 1/2/3 data.
 */
export async function computeRmPillars(rmId: string, period: { from: Date; to: Date }): Promise<RmPillars> {
  const { from, to } = period;
  const clientFilter = { assignedToId: rmId, isDeleted: false };

  const [
    contactedActivities,
    meetingsCompleted,
    followUpsCompleted,
    overdueFollowUps,
    activeOrCompletedClients,
    fundedRecords,
    investmentTxns,
    investedHistoryRows,
  ] = await Promise.all([
    prisma.activity.findMany({
      where: { userId: rmId, type: "CONTACT", createdAt: { gte: from, lt: to } },
      select: { clientId: true },
      distinct: ["clientId"],
    }),
    prisma.activity.count({ where: { userId: rmId, type: "MEETING", createdAt: { gte: from, lt: to } } }),
    prisma.task.count({ where: { assignedToId: rmId, status: "DONE", updatedAt: { gte: from, lt: to } } }),
    prisma.task.count({ where: { assignedToId: rmId, status: "OVERDUE" } }),
    prisma.client.findMany({ where: { ...clientFilter, status: { in: ["ACTIVE", "COMPLETED"] } }, select: { id: true } }),
    prisma.fundingRecord.findMany({
      where: { client: clientFilter, status: "FULLY_FUNDED", updatedAt: { gte: from, lt: to } },
      select: { amount: true },
    }),
    prisma.transaction.findMany({
      where: { tradingAccount: { client: clientFilter }, transactionDate: { gte: from, lt: to }, transactionType: { in: ["BUY", "SIP"] } },
      select: { grossAmount: true },
    }),
    prisma.opportunityStageHistory.findMany({
      where: { toStage: "INVESTED", changedAt: { gte: from, lt: to }, opportunity: { ownerId: rmId } },
      select: { opportunity: { select: { estimatedValue: true } } },
    }),
  ]);

  const clientIds = activeOrCompletedClients.map((c) => c.id);
  const [kycApprovedCount, wealthCheckupCompletedCount, smartAllvestCompletedCount, distinctAccountClients] = clientIds.length
    ? await Promise.all([
        prisma.kycRecord.count({ where: { clientId: { in: clientIds }, status: "APPROVED" } }),
        prisma.wealthHealthCheckup.count({ where: { clientId: { in: clientIds }, status: "COMPLETED" } }),
        prisma.smartAllvestProfile.count({ where: { clientId: { in: clientIds }, status: "COMPLETED" } }),
        prisma.tradingAccount.findMany({ where: { clientId: { in: clientIds } }, select: { clientId: true }, distinct: ["clientId"] }),
      ])
    : [0, 0, 0, []];

  const denom = clientIds.length;
  const pct = (numerator: number) => (denom > 0 ? Math.round((numerator / denom) * 1000) / 10 : 0);
  const followUpDenom = followUpsCompleted + overdueFollowUps;

  return {
    activity: {
      clientsContacted: contactedActivities.length,
      meetingsCompleted,
      followUpsCompleted,
      followUpCompletionRate: followUpDenom > 0 ? Math.round((followUpsCompleted / followUpDenom) * 1000) / 10 : 100,
    },
    journey: {
      kycCompletionRate: pct(kycApprovedCount),
      wealthHealthCheckupCompletionRate: pct(wealthCheckupCompletedCount),
      smartAllvestCompletionRate: pct(smartAllvestCompletedCount),
    },
    business: {
      fundsReceived: fundedRecords.reduce((sum, r) => sum + (r.amount ? Number(r.amount) : 0), 0),
      investmentsExecuted: investmentTxns.length,
      netAumAdded: investedHistoryRows.reduce((sum, r) => sum + Number(r.opportunity.estimatedValue), 0),
      productPenetrationRate: pct(distinctAccountClients.length),
    },
  };
}
