import { addDays } from "date-fns";

import { prisma } from "@/lib/db/prisma";
import { istDayBoundaries } from "@/lib/utils/ist-date";

export type RmDailyReport = {
  rmName: string;
  date: Date;
  clientActivity: {
    clientsContacted: number;
    meetingsCompleted: number;
    followUpsCompleted: number;
    overdueFollowUps: number;
  };
  clientProgress: {
    kycCompleted: number;
    clientsFunded: number;
    investmentsCompleted: number;
  };
  business: {
    fundsReceived: number;
    investmentCompleted: number;
  };
  priorityClients: { id: string; name: string; clientCode: string }[];
  blockers: { clientId: string; clientName: string; reason: string }[];
  tomorrowsPriorities: {
    followUps: number;
    meetings: number;
    funding: number;
    other: number;
  };
};

/**
 * Pure, date-parameterized report generator — any past day can be regenerated from historical
 * Activity/Task/StageHistory/FundingRecord/Transaction timestamps, no snapshot persistence needed.
 * Fields with no backing data yet (Recommendations discussed, New potential identified,
 * Funds committed, Wealth Health Checkup/Smart Allvest completed — all depend on the not-yet-built
 * Opportunity Management / Wealth Workspace modules) are deliberately omitted here rather than
 * faked; the rendering layer shows an explicit "Available once Opportunity Management ships" note
 * for those, never a zero.
 */
export async function generateRmDailyReport(rmId: string, date: Date): Promise<RmDailyReport> {
  const rm = await prisma.user.findUniqueOrThrow({ where: { id: rmId }, select: { name: true } });

  // IST-anchored, not runtime-local — the production runtime's own timezone (typically UTC on
  // Vercel) would otherwise put the day boundary up to 5.5 hours off from the actual IST calendar
  // day this India-only app's RMs mean by "today".
  const { dayStart, dayEnd } = istDayBoundaries(date);
  const tomorrowStart = dayEnd;
  const tomorrowEnd = addDays(tomorrowStart, 1);

  const clientFilter = { assignedToId: rmId };

  const [
    contactedActivities,
    meetingsCompleted,
    followUpsCompleted,
    overdueFollowUps,
    kycCompleted,
    fundedRecords,
    investmentTransactions,
    openExceptions,
    priorityClients,
    tomorrowTasks,
  ] = await Promise.all([
    prisma.activity.findMany({
      where: { userId: rmId, type: "CONTACT", createdAt: { gte: dayStart, lt: dayEnd } },
      select: { clientId: true },
      distinct: ["clientId"],
    }),
    prisma.activity.count({ where: { userId: rmId, type: "MEETING", createdAt: { gte: dayStart, lt: dayEnd } } }),
    prisma.task.count({ where: { assignedToId: rmId, status: "DONE", updatedAt: { gte: dayStart, lt: dayEnd } } }),
    prisma.task.count({ where: { assignedToId: rmId, status: "OVERDUE" } }),
    prisma.stageHistory.count({
      where: { client: clientFilter, toStage: { name: "KYC completed" }, changedAt: { gte: dayStart, lt: dayEnd } },
    }),
    prisma.fundingRecord.findMany({
      where: { client: clientFilter, status: "FULLY_FUNDED", updatedAt: { gte: dayStart, lt: dayEnd } },
      select: { amount: true },
    }),
    prisma.transaction.findMany({
      where: {
        tradingAccount: { client: clientFilter },
        transactionDate: { gte: dayStart, lt: dayEnd },
        transactionType: { in: ["BUY", "SIP"] },
      },
      select: { grossAmount: true },
    }),
    prisma.exception.findMany({
      where: { client: clientFilter, status: "OPEN" },
      select: { reason: true, client: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.client.findMany({
      where: { ...clientFilter, status: "ACTIVE", priority: "HIGH" },
      select: { id: true, name: true, clientCode: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.task.findMany({
      where: { assignedToId: rmId, status: "PENDING", dueAt: { gte: tomorrowStart, lt: tomorrowEnd } },
      select: { category: true },
    }),
  ]);

  const fundsReceived = fundedRecords.reduce((sum, r) => sum + (r.amount ? Number(r.amount) : 0), 0);
  const investmentCompleted = investmentTransactions.reduce((sum, t) => sum + Number(t.grossAmount), 0);

  const tomorrowByCategory = { FOLLOW_UP: 0, MEETING: 0, FUNDING: 0, OTHER: 0 };
  for (const task of tomorrowTasks) tomorrowByCategory[task.category] += 1;

  return {
    rmName: rm.name,
    date: dayStart,
    clientActivity: {
      clientsContacted: contactedActivities.length,
      meetingsCompleted,
      followUpsCompleted,
      overdueFollowUps,
    },
    clientProgress: {
      kycCompleted,
      clientsFunded: fundedRecords.length,
      investmentsCompleted: investmentTransactions.length,
    },
    business: {
      fundsReceived,
      investmentCompleted,
    },
    priorityClients,
    blockers: openExceptions.map((e) => ({ clientId: e.client.id, clientName: e.client.name, reason: e.reason })),
    tomorrowsPriorities: {
      followUps: tomorrowByCategory.FOLLOW_UP,
      meetings: tomorrowByCategory.MEETING,
      funding: tomorrowByCategory.FUNDING,
      other: tomorrowByCategory.OTHER,
    },
  };
}
