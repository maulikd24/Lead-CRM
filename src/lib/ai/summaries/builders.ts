import { format } from "date-fns";

import { prisma } from "@/lib/db/prisma";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { computeSlaStatus, isReferralLeadSource, stageAgeHours } from "@/lib/stage-engine/sla-status";
import { computeClientSnapshot } from "@/lib/clients/snapshot";
import { latestPositionPerHolding } from "@/lib/households/latest-positions";
import { buildWorklist } from "@/lib/copilot/worklist";
import { getReportsPageData } from "@/lib/reports/get-reports-page-data";
import { getTeamActivityRows, type TeamActivityRow } from "@/lib/reports/team-performance";
import { computeRmPillars } from "@/lib/reports/rm-pillars";
import { parseManagementPeriodParams } from "@/lib/reports/period-range";
import { istDateKey, istDayBoundaries } from "@/lib/utils/ist-date";
import { safeLine } from "@/lib/ai/summaries/redact";
import type { Prisma, Role } from "@/generated/prisma/client";

// Each builder turns one page's data into a compact plain-text fact sheet for the AI. Rules:
//  * enforce the SAME visibility the page itself enforces (a summary must never reveal more than the page);
//  * business facts only — never PAN, mobile, email, bank details or raw transcripts, and every free-text value
//    goes through safeLine()/redactPii();
//  * stable ordering/formatting, because the cache key is a hash of the exact text.

export type SummaryUser = { id: string; role: Role; name: string };
export type BuiltFacts = { subjectKey: string; instruction: string; facts: string };

const inr = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
const day = (date: Date | null | undefined) => (date ? format(date, "d MMM yyyy") : "n/a");

function scopedClientFilter(visibleUserIds: string[] | null): Prisma.ClientWhereInput {
  return visibleUserIds ? { assignedToId: { in: visibleUserIds }, isDeleted: false } : { isDeleted: false };
}

export async function buildClientFacts(clientId: string, user: SummaryUser): Promise<BuiltFacts> {
  const visibleUserIds = await getVisibleUserIds(user.id, user.role);
  const [client, tasks, activities, opportunities, positions, trades, tradeCount, payments, reviews] = await Promise.all([
    prisma.client.findUnique({
      where: { id: clientId },
      include: { assignedTo: { select: { name: true } }, currentStage: true, kycRecord: true, fundingRecord: true, dealerIntroduction: true },
    }),
    prisma.task.findMany({ where: { clientId, status: { in: ["PENDING", "OVERDUE"] } }, orderBy: { dueAt: "asc" }, take: 6 }),
    prisma.activity.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.opportunity.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: 6 }),
    prisma.position.findMany({
      where: { tradingAccount: { clientId } },
      include: { product: { select: { name: true, category: true } } },
    }),
    prisma.transaction.findMany({
      where: { tradingAccount: { clientId } },
      include: { product: { select: { name: true } } },
      orderBy: { transactionDate: "desc" },
      take: 1,
    }),
    prisma.transaction.count({
      where: { tradingAccount: { clientId }, transactionDate: { gte: new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000) } },
    }),
    prisma.clientPayment.groupBy({ by: ["paymentType"], where: { clientId, status: "SUCCESS" }, _sum: { amount: true } }),
    prisma.conversationReview.findMany({
      where: { clientId, status: "ANALYZED" },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { sourceType: true, sentimentLabel: true, qualityScore: true, recommendationText: true },
    }),
  ]);

  const managerMayOpenUnassigned = !!client && !client.assignedToId && user.role === "MANAGER";
  if (!client || (visibleUserIds && !managerMayOpenUnassigned && (!client.assignedToId || !visibleUserIds.includes(client.assignedToId)))) {
    throw new Error("Client not found");
  }

  const now = new Date();
  const ageHours = stageAgeHours(client.stageEnteredAt, now);
  const sla = isReferralLeadSource(client.leadSource) ? "not applicable (referral)" : computeSlaStatus(client.stageEnteredAt, client.currentStage.slaHours, now).toLowerCase().replace(/_/g, " ");

  const latestPositions = latestPositionPerHolding(positions).map((p) => ({
    productId: p.productId,
    tradingAccountId: p.tradingAccountId,
    currentValue: p.currentValue ? Number(p.currentValue) : null,
    asOfDate: p.asOfDate,
    product: p.product,
  }));
  const sumFor = (type: string) => Number(payments.find((g) => g.paymentType === type)?._sum.amount ?? 0);
  const snapshot = computeClientSnapshot({
    latestPositions,
    opportunities: opportunities.map((o) => ({ stage: o.stage, estimatedAum: o.estimatedAum ? Number(o.estimatedAum) : null })),
    fundingRecord: client.fundingRecord
      ? { status: client.fundingRecord.status, amount: client.fundingRecord.amount ? Number(client.fundingRecord.amount) : null, fundingDate: client.fundingRecord.fundingDate }
      : null,
    recentTrades: trades.map((t) => ({
      id: t.id,
      date: t.transactionDate,
      type: t.transactionType,
      productName: t.product?.name ?? null,
      quantity: t.quantity ? Number(t.quantity) : null,
      price: t.price ? Number(t.price) : null,
      amount: Number(t.grossAmount),
      accountNumber: "",
    })),
    tradesLast30Days: tradeCount,
    tradesLastSyncedAt: null,
    paymentTotals: { fundsIn: sumFor("FUNDS_IN"), fundsOut: sumFor("FUNDS_OUT"), fees: sumFor("FEE"), lastSyncedAt: null },
  });

  const lines = [
    `Client: ${client.name} (${client.clientCode}); status ${client.status.toLowerCase().replace(/_/g, " ")}; priority ${client.priority.toLowerCase()}.`,
    `Profile: type ${client.clientType ?? "n/a"}; investment category ${client.investmentCategory ?? "n/a"}; lead source ${client.leadSource ?? "n/a"}; product interest ${client.productInterest ?? "n/a"}; expected investment ${client.expectedInvestment ? inr(Number(client.expectedInvestment)) : "n/a"}; region ${client.region ?? "n/a"}.`,
    `Owner: ${client.assignedTo?.name ?? "unassigned"}. Created ${day(client.createdAt)}.`,
    `Onboarding: stage "${client.currentStage.name}" for ${ageHours < 24 ? `${Math.round(ageHours)} hours` : `${Math.round(ageHours / 24)} days`}; SLA ${sla}.`,
    `KYC: ${client.kycRecord ? `${client.kycRecord.status.toLowerCase().replace(/_/g, " ")}${client.kycRecord.rejectionReason ? ` (reason: ${safeLine(client.kycRecord.rejectionReason, 100)})` : ""}` : "not started"}.`,
    `Funds added: ${snapshot.funds.added ? `yes${snapshot.funds.amount !== null ? ` (${inr(snapshot.funds.amount)})` : ""}` : "no"}; funding status ${client.fundingRecord?.status.toLowerCase().replace(/_/g, " ") ?? "not started"}.`,
    `Dealer handoff: ${client.dealerIntroduction?.status.toLowerCase() ?? "not started"}.`,
    `AUM: ${snapshot.aum.holdingsCount > 0 ? `${inr(snapshot.aum.total)} across ${snapshot.aum.holdingsCount} holdings (${snapshot.aum.allocation.map((a) => `${a.bucket} ${a.pct}%`).join(", ")})` : "no holdings synced"}; estimated pipeline AUM ${inr(snapshot.aum.pipelineEstimatedAum)}.`,
    `Trading: ${snapshot.lastTrade.trade ? `last trade ${snapshot.lastTrade.trade.type.toLowerCase()} of ${snapshot.lastTrade.trade.productName ?? "a product"} for ${inr(snapshot.lastTrade.trade.amount)} on ${day(snapshot.lastTrade.trade.date)}; ${snapshot.lastTrade.tradesLast30Days} trades in 30 days` : "no trades on file"}.`,
    `Payments: received ${inr(sumFor("FUNDS_IN"))}, withdrawn ${inr(sumFor("FUNDS_OUT"))}, fees ${inr(sumFor("FEE"))}.`,
    `Open tasks: ${tasks.length ? tasks.map((t) => `"${safeLine(t.title, 60)}" due ${day(t.dueAt)}${t.status === "OVERDUE" ? " (overdue)" : ""}`).join("; ") : "none"}.`,
    `Opportunities: ${opportunities.length ? opportunities.map((o) => `${o.product.toLowerCase().replace(/_/g, " ")} at ${o.stage.toLowerCase().replace(/_/g, " ")} (${inr(Number(o.estimatedValue))})`).join("; ") : "none"}.`,
    `Recent conversation reviews: ${reviews.length ? reviews.map((r) => `${r.sourceType === "CALL" ? "call" : "WhatsApp"} sentiment ${r.sentimentLabel ?? "n/a"}, quality ${r.qualityScore ?? "n/a"}/100${r.recommendationText ? `, suggested: ${safeLine(r.recommendationText, 90)}` : ""}`).join("; ") : "none"}.`,
    `Recent activity (newest first): ${activities.length ? activities.map((a) => {
      const message = (a.payload as { message?: unknown } | null)?.message;
      return `${day(a.createdAt)} ${a.type.toLowerCase().replace(/_/g, " ")}${typeof message === "string" ? ` – ${safeLine(message, 100)}` : ""}`;
    }).join(" | ") : "none"}.`,
    client.notes ? `Notes: ${safeLine(client.notes, 200)}` : "",
  ].filter(Boolean);

  return {
    subjectKey: clientId,
    instruction: "Summarise this client profile for the relationship manager who has just opened it: who they are, where onboarding stands, money and holdings, recent interactions, and what to do next.",
    facts: lines.join("\n"),
  };
}

export async function buildMyDayFacts(user: SummaryUser): Promise<BuiltFacts> {
  const visibleUserIds = await getVisibleUserIds(user.id, user.role);
  const now = new Date();
  const { dayStart, dayEnd } = istDayBoundaries(now);
  const clientFilter = scopedClientFilter(visibleUserIds);

  const [overdue, overdueCount, dueToday, newLeads, unassigned, worklist] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: user.id, status: { in: ["PENDING", "OVERDUE"] }, dueAt: { lt: now } },
      include: { client: { select: { name: true } } },
      orderBy: { dueAt: "asc" },
      take: 5,
    }),
    prisma.task.count({ where: { assignedToId: user.id, status: { in: ["PENDING", "OVERDUE"] }, dueAt: { lt: now } } }),
    prisma.task.count({ where: { assignedToId: user.id, status: "PENDING", dueAt: { gte: dayStart, lt: dayEnd } } }),
    prisma.client.count({ where: { ...clientFilter, status: "ACTIVE", createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } }),
    user.role === "ADMIN" || user.role === "MANAGER"
      ? prisma.client.count({ where: { assignedToId: null, isDeleted: false, mergedIntoId: null, status: "ACTIVE" } })
      : Promise.resolve(null),
    buildWorklist(visibleUserIds),
  ]);

  const lines = [
    `Person: ${user.name} (${user.role.toLowerCase()}). Date: ${istDateKey(now)}.`,
    `Overdue tasks: ${overdueCount}${overdue.length ? ` — oldest: ${overdue.map((t) => `"${safeLine(t.title, 50)}" for ${t.client.name} (due ${day(t.dueAt)})`).join("; ")}` : ""}.`,
    `Tasks due today: ${dueToday}.`,
    `New leads in the last 24 hours (in scope): ${newLeads}.`,
    unassigned !== null ? `Unassigned active leads waiting for an owner: ${unassigned}.` : "",
    `Co-pilot worklist: ${worklist.summary.critical} critical, ${worklist.summary.atRisk} at risk, ${worklist.summary.disengaged} disengaged, ${worklist.summary.crossSellCandidates} cross-sell candidates.`,
    `Top suggested actions: ${worklist.entries.slice(0, 5).map((e) => `${e.client.name} (${e.client.stageName}) – ${safeLine(e.nba.label, 80)}`).join("; ") || "none"}.`,
  ].filter(Boolean);

  return {
    subjectKey: `${user.id}:${istDateKey(now)}`,
    instruction: "Write a short daily briefing for this person: what most needs attention today and where to start.",
    facts: lines.join("\n"),
  };
}

/** Manager Dashboard (period-scoped cohort) and Reports (all-time snapshot) share one builder. */
export async function buildManagementFacts(user: SummaryUser, kind: "management" | "reports", period: Record<string, string>): Promise<BuiltFacts> {
  const visibleUserIds = await getVisibleUserIds(user.id, user.role);
  const now = new Date();
  const clientFilter = scopedClientFilter(visibleUserIds);

  const range = kind === "management" ? parseManagementPeriodParams(period, now) : null;
  const data = await getReportsPageData(clientFilter, visibleUserIds, now, range ? { from: range.from, to: range.to } : undefined);

  const conversion = new Map(data.conversionData.map((c) => [c.stageId, c]));
  const topRms = [...data.rmPerformance].sort((a, b) => b.active - a.active).slice(0, 8);

  const lines = [
    kind === "management" && range
      ? `Scope: leads created ${day(range.from)} to ${day(range.to)} (${range.isCustom ? "custom range" : range.granularity}); viewer sees ${visibleUserIds ? "their own team" : "the whole organisation"}.`
      : `Scope: all-time snapshot; viewer sees ${visibleUserIds ? "their own team" : "the whole organisation"}.`,
    `Totals: ${data.totalLeads} leads; ${data.activeClients} active; ${data.onHoldClients} on hold; ${data.completedClients} completed; ${data.notProceedingClients} lost/not proceeding.`,
    `SLA compliance ${data.slaCompliance}% (${data.overdueCount} active clients currently overdue). Average onboarding time ${data.avgOnboardingDays} days.`,
    `Pipeline by stage: ${data.funnelData.map((f) => `${f.stage} ${f.count}${conversion.get(f.stageId) ? ` (reached ${conversion.get(f.stageId)!.pct}%)` : ""}`).join("; ")}.`,
    `Average time in stage: ${data.stageDurations.map((d) => `${d.stageName} ${d.avgHours < 24 ? `${Math.round(d.avgHours)}h` : `${Math.round((d.avgHours / 24) * 10) / 10}d`}`).join("; ") || "n/a"}.`,
    `Lost reasons: ${data.lostReasonGroups.slice(0, 4).map((r) => `${r.reason ?? "unspecified"} ${r.count}`).join("; ") || "none"}.`,
    `Lead sources: ${data.sourcePerformance.slice(0, 5).map((s) => `${s.source} ${s.total} (${s.completed} completed)`).join("; ") || "none"}.`,
    `RM performance: ${topRms.map((r) => `${r.rm.name}: ${r.active} active, ${r.completed} completed, ${r.onHold} on hold, SLA ${r.rmSlaPct}%, ${r.overdueTasks} overdue tasks, avg ${r.rmAvgDays}d`).join(" | ") || "none"}.`,
  ];

  return {
    subjectKey: kind === "management" && range ? `${user.id}:${format(range.from, "yyyy-MM-dd")}_${format(range.to, "yyyy-MM-dd")}` : `${user.id}:all`,
    instruction:
      kind === "management"
        ? "Summarise this period's team performance and pipeline for a manager: how things are going, the main bottleneck, who stands out or needs help."
        : "Summarise the organisation's onboarding performance for a manager: pipeline health, SLA, bottlenecks and standout RMs.",
    facts: lines.join("\n"),
  };
}

export async function buildQualityReviewFacts(reviewId: string, user: SummaryUser): Promise<BuiltFacts> {
  const visibleUserIds = await getVisibleUserIds(user.id, user.role);
  const review = await prisma.conversationReview.findUnique({
    where: { id: reviewId },
    include: { client: { select: { name: true, clientCode: true } } },
  });
  if (!review || (visibleUserIds && (!review.assignedRmId || !visibleUserIds.includes(review.assignedRmId)))) {
    throw new Error("Review not found");
  }

  const breakdown = Array.isArray(review.qualityBreakdown)
    ? (review.qualityBreakdown as { criterion: string; score: number; maxScore: number; notes?: string }[])
    : [];

  // Deliberately NOT sending the transcript: the stored findings carry what the summary needs.
  const lines = [
    `Review of a ${review.sourceType === "CALL" ? "phone call" : "WhatsApp conversation"} with ${review.client.name} (${review.client.clientCode}); status ${review.status.toLowerCase().replace(/_/g, " ")}.`,
    `Sentiment: ${review.sentimentLabel ?? "n/a"}${review.sentimentScore !== null && review.sentimentScore !== undefined ? ` (${review.sentimentScore})` : ""}. ${safeLine(review.sentimentReasoning, 220)}`,
    `Quality score: ${review.qualityScore ?? "n/a"}/100${review.overriddenScore !== null ? `; reviewer override ${review.overriddenScore}` : ""}.`,
    `Criteria: ${breakdown.map((b) => `${b.criterion} ${b.score}/${b.maxScore}${b.notes ? ` (${safeLine(b.notes, 80)})` : ""}`).join("; ") || "n/a"}.`,
    `Recommended next action: ${safeLine(review.recommendationText, 200) || "n/a"}.`,
    review.reviewNotes ? `Reviewer notes: ${safeLine(review.reviewNotes, 200)}` : "",
  ].filter(Boolean);

  return {
    subjectKey: reviewId,
    instruction: "Summarise this conversation review: how the conversation went, what was done well or badly, and the recommended follow-up.",
    facts: lines.join("\n"),
  };
}

const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

function activityLine(row: TeamActivityRow | undefined) {
  if (!row) return "no activity data";
  return `${row.leadsAssigned} leads assigned, ${row.clientsContacted} clients contacted, ${row.meetingsCompleted} meetings, ${row.followUpsCompleted} follow-ups done, ${row.kycCompleted} KYC completed, ${inr(row.fundsReceived)} funds received, ${row.investmentsExecuted} investments executed`;
}

/**
 * One RM's performance, with the team average alongside so the summary can say whether they are ahead or behind.
 * `period` is the same pillars window the RM page shows (pillarsFrom / pillarsTo, default last 30 days).
 */
export async function buildRmIndividualFacts(rmId: string, user: SummaryUser, period: Record<string, string>): Promise<BuiltFacts> {
  const visibleUserIds = await getVisibleUserIds(user.id, user.role);
  if (visibleUserIds && !visibleUserIds.includes(rmId)) throw new Error("RM not found");

  const rm = await prisma.user.findUnique({ where: { id: rmId, role: "RM" }, include: { manager: { select: { name: true } } } });
  if (!rm) throw new Error("RM not found");

  const now = new Date();
  const to = period.pillarsTo ? new Date(`${period.pillarsTo}T23:59:59.999`) : now;
  const from = period.pillarsFrom ? new Date(`${period.pillarsFrom}T00:00:00`) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [own, team, pillars, overdueCandidates, openExceptions] = await Promise.all([
    getReportsPageData({ assignedToId: rmId, isDeleted: false }, [rmId], now),
    getReportsPageData(scopedClientFilter(visibleUserIds), visibleUserIds, now),
    computeRmPillars(rmId, { from, to }),
    prisma.client.findMany({
      where: { assignedToId: rmId, status: "ACTIVE", isDeleted: false, mergedIntoId: null },
      include: { currentStage: true },
      orderBy: { stageEnteredAt: "asc" },
      take: 60,
    }),
    prisma.exception.count({ where: { status: "OPEN", client: { assignedToId: rmId } } }),
  ]);

  const peerIds = team.rmPerformance.map((r) => r.rm.id);
  const activity = await getTeamActivityRows([...new Set([...peerIds, rmId])], { from, to });
  const mine = own.rmPerformance.find((r) => r.rm.id === rmId);
  const peers = team.rmPerformance;
  const slaRank = [...peers].sort((a, b) => b.rmSlaPct - a.rmSlaPct).findIndex((r) => r.rm.id === rmId) + 1;
  const peerActivity = peerIds.map((id) => activity.get(id)).filter((r): r is TeamActivityRow => !!r);

  const overdue = overdueCandidates
    .filter((c) => !isReferralLeadSource(c.leadSource) && computeSlaStatus(c.stageEnteredAt, c.currentStage.slaHours, now) === "OVERDUE")
    .slice(0, 5);

  const lines = [
    `RM: ${rm.name}; manager ${rm.manager?.name ?? "none"}; capacity ${rm.capacity ?? "not set"}; regions ${rm.regions.join(", ") || "any"}; languages ${rm.languages.join(", ") || "any"}; availability ${rm.availabilityStatus.toLowerCase().replace(/_/g, " ")}.`,
    mine
      ? `Current book: ${mine.active} active clients${rm.capacity ? ` (${Math.round((mine.active / rm.capacity) * 100)}% of capacity)` : ""}, ${mine.completed} completed, ${mine.onHold} on hold; SLA compliance ${mine.rmSlaPct}% (${mine.rmOverdue} clients overdue); ${mine.overdueTasks} overdue tasks; average onboarding ${mine.rmAvgDays} days.`
      : "Current book: no data.",
    `Team comparison (${peers.length} RMs in scope): team average SLA compliance ${round1(avg(peers.map((r) => r.rmSlaPct)))}%, average onboarding ${round1(avg(peers.map((r) => r.rmAvgDays)))} days, average ${round1(avg(peers.map((r) => r.active)))} active clients, average ${round1(avg(peers.map((r) => r.overdueTasks)))} overdue tasks. This RM ranks ${slaRank || "n/a"} of ${peers.length} on SLA compliance.`,
    `Pipeline of this RM's clients by stage: ${own.funnelData.map((f) => `${f.stage} ${f.count}`).join("; ")}.`,
    `Average time in stage for this RM's clients: ${own.stageDurations.map((d) => `${d.stageName} ${d.avgHours < 24 ? `${Math.round(d.avgHours)}h` : `${round1(d.avgHours / 24)}d`}`).join("; ") || "n/a"}.`,
    `Period ${day(from)} to ${day(to)} — this RM: ${activityLine(activity.get(rmId))}.`,
    `Period team average per RM: ${peerActivity.length ? `${round1(avg(peerActivity.map((r) => r.leadsAssigned)))} leads assigned, ${round1(avg(peerActivity.map((r) => r.clientsContacted)))} contacted, ${round1(avg(peerActivity.map((r) => r.meetingsCompleted)))} meetings, ${round1(avg(peerActivity.map((r) => r.followUpsCompleted)))} follow-ups, ${round1(avg(peerActivity.map((r) => r.kycCompleted)))} KYC completed, ${inr(avg(peerActivity.map((r) => r.fundsReceived)))} funds, ${round1(avg(peerActivity.map((r) => r.investmentsExecuted)))} investments` : "n/a"}.`,
    `Pillars this period: follow-up completion ${pillars.activity.followUpCompletionRate}%; KYC completion ${pillars.journey.kycCompletionRate}%, wealth health checkups ${pillars.journey.wealthHealthCheckupCompletionRate}%, Smart Allvest profiles ${pillars.journey.smartAllvestCompletionRate}%; net AUM added ${inr(pillars.business.netAumAdded)}; product penetration ${pillars.business.productPenetrationRate}%.`,
    `Clients currently overdue at their stage: ${overdue.length ? overdue.map((c) => `${c.name} at ${c.currentStage.name} (${Math.round(stageAgeHours(c.stageEnteredAt, now) / 24)}d)`).join("; ") : "none"}.`,
    `Open exceptions on this RM's clients: ${openExceptions}.`,
    `Lost reasons: ${own.lostReasonGroups.slice(0, 3).map((r) => `${r.reason ?? "unspecified"} ${r.count}`).join("; ") || "none"}. Lead sources: ${own.sourcePerformance.slice(0, 4).map((r) => `${r.source} ${r.total} (${r.completed} completed)`).join("; ") || "none"}.`,
  ];

  return {
    subjectKey: `${user.id}:${rmId}:${format(from, "yyyy-MM-dd")}_${format(to, "yyyy-MM-dd")}`,
    instruction:
      "Summarise this relationship manager's performance for their manager: how they are doing against the team, what they are doing well, where they are slipping, and one concrete coaching or support action.",
    facts: lines.join("\n"),
  };
}

/** All RMs in scope compared side by side, current book plus period activity. */
export async function buildRmOverallFacts(user: SummaryUser, period: Record<string, string>): Promise<BuiltFacts> {
  const visibleUserIds = await getVisibleUserIds(user.id, user.role);
  const now = new Date();
  const range = parseManagementPeriodParams(period, now);

  const data = await getReportsPageData(scopedClientFilter(visibleUserIds), visibleUserIds, now);
  const rows = data.rmPerformance;
  const activity = await getTeamActivityRows(rows.map((r) => r.rm.id), { from: range.from, to: range.to });

  const bySla = [...rows].sort((a, b) => b.rmSlaPct - a.rmSlaPct);
  const nearCapacity = rows.filter((r) => r.rm.capacity && r.active / r.rm.capacity >= 0.9);
  const totals = {
    contacted: rows.reduce((s, r) => s + (activity.get(r.rm.id)?.clientsContacted ?? 0), 0),
    meetings: rows.reduce((s, r) => s + (activity.get(r.rm.id)?.meetingsCompleted ?? 0), 0),
    kyc: rows.reduce((s, r) => s + (activity.get(r.rm.id)?.kycCompleted ?? 0), 0),
    funds: rows.reduce((s, r) => s + (activity.get(r.rm.id)?.fundsReceived ?? 0), 0),
    investments: rows.reduce((s, r) => s + (activity.get(r.rm.id)?.investmentsExecuted ?? 0), 0),
  };

  const lines = [
    `Scope: ${rows.length} RMs; viewer sees ${visibleUserIds ? "their own team" : "the whole organisation"}. Activity period ${day(range.from)} to ${day(range.to)}; book figures are current.`,
    `Team averages: SLA compliance ${round1(avg(rows.map((r) => r.rmSlaPct)))}%, onboarding ${round1(avg(rows.map((r) => r.rmAvgDays)))} days, ${round1(avg(rows.map((r) => r.active)))} active clients, ${round1(avg(rows.map((r) => r.overdueTasks)))} overdue tasks per RM.`,
    `Period team totals: ${totals.contacted} clients contacted, ${totals.meetings} meetings, ${totals.kyc} KYC completed, ${inr(totals.funds)} funds received, ${totals.investments} investments executed.`,
    `Best SLA compliance: ${bySla[0] ? `${bySla[0].rm.name} ${bySla[0].rmSlaPct}%` : "n/a"}. Lowest: ${bySla.length ? `${bySla[bySla.length - 1].rm.name} ${bySla[bySla.length - 1].rmSlaPct}%` : "n/a"}.`,
    `Near or over capacity (90%+): ${nearCapacity.map((r) => `${r.rm.name} ${r.active}/${r.rm.capacity}`).join("; ") || "none"}.`,
    "Per RM:",
    ...rows.map(
      (r) =>
        `- ${r.rm.name}: book ${r.active} active${r.rm.capacity ? `/${r.rm.capacity} capacity` : ""}, ${r.completed} completed, ${r.onHold} on hold, SLA ${r.rmSlaPct}%, ${r.overdueTasks} overdue tasks, avg ${r.rmAvgDays}d; period: ${activityLine(activity.get(r.rm.id))}.`,
    ),
  ];

  return {
    subjectKey: `${user.id}:rm-overall:${format(range.from, "yyyy-MM-dd")}_${format(range.to, "yyyy-MM-dd")}`,
    instruction:
      "Summarise how the team of relationship managers is performing overall for a manager: who is leading, who needs support, workload balance, and the one action that would help most.",
    facts: lines.join("\n"),
  };
}
