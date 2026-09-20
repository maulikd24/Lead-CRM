import { prisma } from "@/lib/db/prisma";
import { getReportsPageData } from "@/lib/reports/get-reports-page-data";
import { getLeadsActivity } from "@/lib/reports/leads-activity";
import type { Prisma } from "@/generated/prisma/client";

export type ManagementReportData = {
  periodLabel: string;
  newLeads: number;
  updatedLeads: number;
  totalLeads: number;
  activeClients: number;
  completedClients: number;
  slaCompliance: number;
  funnelData: { stage: string; count: number }[];
  rmPerformance: { rmName: string; active: number; completed: number; slaPct: number }[];
  topOpportunities: { clientName: string; clientCode: string; product: string; stage: string; estimatedValue: number }[];
  openExceptionsCount: number;
  fundsReceived: number;
  investmentsExecuted: number;
};

/**
 * One assembly function shared by the daily org-wide email, and Module 6's weekly/monthly
 * management reports — same "one computation, many consumers" precedent as getReportsPageData
 * itself. Org-wide/unscoped (visibleUserIds: null), matching the existing daily email's own scope
 * (a single fixed recipient gets the whole org's numbers, not a per-manager slice).
 */
export async function assembleManagementReportData(periodLabel: string, from: Date, to: Date, now: Date): Promise<ManagementReportData> {
  const clientFilter: Prisma.ClientWhereInput = { isDeleted: false };

  const [reportsData, activityBuckets, topOpportunities, openExceptionsCount, fundedRecords, investmentTxns] = await Promise.all([
    getReportsPageData(clientFilter, null, now),
    getLeadsActivity({ from, to, granularity: "day", clientWhere: clientFilter }),
    prisma.opportunity.findMany({
      where: { stage: { notIn: ["LOST_DEFERRED", "INVESTED"] } },
      orderBy: { estimatedValue: "desc" },
      take: 10,
      select: { product: true, stage: true, estimatedValue: true, client: { select: { name: true, clientCode: true } } },
    }),
    prisma.exception.count({ where: { status: "OPEN", client: clientFilter } }),
    prisma.fundingRecord.findMany({
      where: { status: "FULLY_FUNDED", updatedAt: { gte: from, lt: to }, client: clientFilter },
      select: { amount: true },
    }),
    prisma.transaction.findMany({
      where: { transactionDate: { gte: from, lt: to }, transactionType: { in: ["BUY", "SIP"] }, tradingAccount: { client: clientFilter } },
      select: { grossAmount: true },
    }),
  ]);

  const newLeads = activityBuckets.reduce((sum, b) => sum + b.created, 0);
  const updatedLeads = activityBuckets.reduce((sum, b) => sum + b.updated, 0);
  const fundsReceived = fundedRecords.reduce((sum, r) => sum + (r.amount ? Number(r.amount) : 0), 0);
  const investmentsExecuted = investmentTxns.length;

  return {
    periodLabel,
    newLeads,
    updatedLeads,
    totalLeads: reportsData.totalLeads,
    activeClients: reportsData.activeClients,
    completedClients: reportsData.completedClients,
    slaCompliance: reportsData.slaCompliance,
    funnelData: reportsData.funnelData.map((f) => ({ stage: f.stage, count: f.count })),
    rmPerformance: reportsData.rmPerformance.map((r) => ({ rmName: r.rm.name, active: r.active, completed: r.completed, slaPct: r.rmSlaPct })),
    topOpportunities: topOpportunities.map((o) => ({
      clientName: o.client.name,
      clientCode: o.client.clientCode,
      product: o.product.replace(/_/g, " "),
      stage: o.stage.replace(/_/g, " "),
      estimatedValue: Number(o.estimatedValue),
    })),
    openExceptionsCount,
    fundsReceived,
    investmentsExecuted,
  };
}

export function renderManagementReportText(data: ManagementReportData): string {
  return [
    `MANAGEMENT REPORT — ${data.periodLabel}`,
    "",
    "Overview",
    `- New leads: ${data.newLeads}`,
    `- Leads updated: ${data.updatedLeads}`,
    `- Total leads: ${data.totalLeads}`,
    `- Active onboarding: ${data.activeClients}`,
    `- Completed: ${data.completedClients}`,
    `- SLA compliance: ${data.slaCompliance}%`,
    `- Open exceptions: ${data.openExceptionsCount}`,
    "",
    "Client Funnel Movement",
    ...(data.funnelData.length ? data.funnelData.map((f) => `- ${f.stage}: ${f.count}`) : ["- No pipeline stages configured yet."]),
    "",
    "Business",
    `- Funds received: ₹${data.fundsReceived.toLocaleString("en-IN")}`,
    `- Investments executed: ${data.investmentsExecuted}`,
    "",
    "High-Value Opportunities Matrix",
    ...(data.topOpportunities.length
      ? data.topOpportunities.map(
          (o) => `- ${o.clientName} (${o.clientCode}) — ${o.product}, ₹${o.estimatedValue.toLocaleString("en-IN")}, ${o.stage}`,
        )
      : ["- No open opportunities on file yet."]),
    "",
    "RM Performance",
    ...(data.rmPerformance.length
      ? data.rmPerformance.map((r) => `- ${r.rmName}: ${r.active} active, ${r.completed} completed, ${r.slaPct}% SLA`)
      : ["- No RMs to report on yet."]),
  ].join("\n");
}
