import { prisma } from "@/lib/db/prisma";
import { averageOnboardingDays } from "@/lib/reports/get-reports-page-data";
import type { Prisma } from "@/generated/prisma/client";

/**
 * The Manager Dashboard's period-scoped KPIs for any window — clients created in it, same definitions as
 * getReportsPageData's cohort figures — without the rest of that page's work. Used to compare with the previous period.
 */
export async function getCohortKpis(clientFilter: Prisma.ClientWhereInput, range: { from: Date; to: Date }) {
  const cohortWhere: Prisma.ClientWhereInput = { ...clientFilter, createdAt: { gte: range.from, lte: range.to } };
  const [totalLeads, completedClients, completedDurations] = await Promise.all([
    prisma.client.count({ where: cohortWhere }),
    prisma.client.count({ where: { ...cohortWhere, status: "COMPLETED" } }),
    prisma.client.findMany({
      where: { ...cohortWhere, status: "COMPLETED", completedAt: { not: null } },
      select: { createdAt: true, completedAt: true },
    }),
  ]);
  return { totalLeads, completedClients, avgOnboardingDays: averageOnboardingDays(completedDurations) };
}
