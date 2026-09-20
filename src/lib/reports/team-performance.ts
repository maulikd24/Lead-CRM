import { prisma } from "@/lib/db/prisma";

export type TeamActivityRow = {
  rmId: string;
  leadsAssigned: number;
  clientsContacted: number;
  meetingsCompleted: number;
  followUpsCompleted: number;
  kycCompleted: number;
  fundsReceived: number;
  investmentsExecuted: number;
};

/**
 * Period-scoped, per-RM activity/business counts for the Manager Dashboard's Team Performance
 * table — the same metrics generateRmDailyReport() computes for a single RM/single day
 * (src/lib/reports/rm-daily-report.ts), aggregated across a whole team for an arbitrary date range
 * instead. Kept separate from RmPerformanceRow (rm-performance.ts), which is point-in-time
 * (current Active/Completed/SLA%), not period-scoped.
 */
export async function getTeamActivityRows(rmIds: string[], period: { from: Date; to: Date }): Promise<Map<string, TeamActivityRow>> {
  const map = new Map<string, TeamActivityRow>();
  for (const rmId of rmIds) {
    map.set(rmId, { rmId, leadsAssigned: 0, clientsContacted: 0, meetingsCompleted: 0, followUpsCompleted: 0, kycCompleted: 0, fundsReceived: 0, investmentsExecuted: 0 });
  }
  if (rmIds.length === 0) return map;

  const { from, to } = period;

  const [leadsAssignedByRm, contactedActivities, meetingsByRm, followUpsByRm, kycRows, fundedRows, investmentRows] = await Promise.all([
    prisma.client.groupBy({
      by: ["assignedToId"],
      where: { assignedToId: { in: rmIds }, createdAt: { gte: from, lt: to } },
      _count: { _all: true },
    }),
    prisma.activity.findMany({
      where: { userId: { in: rmIds }, type: "CONTACT", createdAt: { gte: from, lt: to } },
      select: { userId: true, clientId: true },
    }),
    prisma.activity.groupBy({
      by: ["userId"],
      where: { userId: { in: rmIds }, type: "MEETING", createdAt: { gte: from, lt: to } },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ["assignedToId"],
      where: { assignedToId: { in: rmIds }, status: "DONE", updatedAt: { gte: from, lt: to } },
      _count: { _all: true },
    }),
    prisma.stageHistory.findMany({
      where: { client: { assignedToId: { in: rmIds } }, toStage: { name: "KYC completed" }, changedAt: { gte: from, lt: to } },
      select: { client: { select: { assignedToId: true } } },
    }),
    prisma.fundingRecord.findMany({
      where: { client: { assignedToId: { in: rmIds } }, status: "FULLY_FUNDED", updatedAt: { gte: from, lt: to } },
      select: { amount: true, client: { select: { assignedToId: true } } },
    }),
    prisma.transaction.findMany({
      where: {
        tradingAccount: { client: { assignedToId: { in: rmIds } } },
        transactionDate: { gte: from, lt: to },
        transactionType: { in: ["BUY", "SIP"] },
      },
      select: { tradingAccount: { select: { client: { select: { assignedToId: true } } } } },
    }),
  ]);

  for (const row of leadsAssignedByRm) {
    if (row.assignedToId && map.has(row.assignedToId)) map.get(row.assignedToId)!.leadsAssigned = row._count._all;
  }

  const contactedByRm = new Map<string, Set<string>>();
  for (const a of contactedActivities) {
    if (!a.userId) continue;
    const set = contactedByRm.get(a.userId) ?? new Set<string>();
    set.add(a.clientId);
    contactedByRm.set(a.userId, set);
  }
  for (const [rmId, set] of contactedByRm) {
    if (map.has(rmId)) map.get(rmId)!.clientsContacted = set.size;
  }

  for (const row of meetingsByRm) {
    if (row.userId && map.has(row.userId)) map.get(row.userId)!.meetingsCompleted = row._count._all;
  }

  for (const row of followUpsByRm) {
    if (row.assignedToId && map.has(row.assignedToId)) map.get(row.assignedToId)!.followUpsCompleted = row._count._all;
  }

  for (const row of kycRows) {
    const rmId = row.client.assignedToId;
    if (rmId && map.has(rmId)) map.get(rmId)!.kycCompleted += 1;
  }

  for (const row of fundedRows) {
    const rmId = row.client.assignedToId;
    if (rmId && map.has(rmId)) map.get(rmId)!.fundsReceived += row.amount ? Number(row.amount) : 0;
  }

  for (const row of investmentRows) {
    const rmId = row.tradingAccount.client.assignedToId;
    if (rmId && map.has(rmId)) map.get(rmId)!.investmentsExecuted += 1;
  }

  return map;
}
