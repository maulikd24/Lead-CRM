import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { computeSlaStatus, stageAgeHours } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";
import { getStageDurations } from "@/lib/reports/stage-durations";
import { computePriorityScore, computeHealthStatus, type PriorityScore, type HealthResult } from "./scoring";
import { getNextBestAction, type NextBestAction } from "./next-best-action";
import { suggestMessageTemplate, type MessageSuggestion } from "./message-suggestion";
import { getCrossSellFlags, type CrossSellFlag } from "./cross-sell";
import { computePropensityScore, PROPENSITY_PROFILE_FIELDS, type PropensityScore } from "./propensity";
import type { CopilotClient } from "./types";

const ENGAGEMENT_ACTIVITY_TYPES = ["CALL", "MESSAGE", "NOTE"] as const;

const CANDIDATE_LIMIT = 200;
const WORKLIST_SIZE = 30;

export type WorklistEntry = {
  client: { id: string; name: string; clientCode: string; stageName: string; assignedToId: string | null };
  priority: PriorityScore;
  health: HealthResult;
  propensity: PropensityScore;
  nba: NextBestAction;
  crossSell: CrossSellFlag[];
  messageSuggestion: MessageSuggestion | null;
  suggestedFollowUp: { title: string; dueAtIso: string };
};

export type WorklistSummary = { critical: number; atRisk: number; disengaged: number; crossSellCandidates: number };

async function fetchCandidates(clientFilter: Prisma.ClientWhereInput) {
  return prisma.client.findMany({
    where: { status: "ACTIVE", ...clientFilter },
    include: {
      currentStage: true,
      documents: true,
      kycRecord: true,
      fundingRecord: true,
      dealerIntroduction: true,
      assignedTo: { select: { name: true } },
      activities: { where: { type: "NOTE" }, select: { type: true, payload: true } },
    },
    orderBy: { stageEnteredAt: "asc" },
    take: CANDIDATE_LIMIT,
  });
}

export async function buildWorklist(visibleUserIds: string[] | null): Promise<{ entries: WorklistEntry[]; summary: WorklistSummary }> {
  const clientFilter: Prisma.ClientWhereInput = visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {};
  const now = new Date();

  const [candidates, stages, templates] = await Promise.all([
    fetchCandidates(clientFilter),
    prisma.stage.findMany({ where: { isActive: true }, orderBy: { sequence: "asc" } }),
    prisma.messageTemplate.findMany({ where: { approved: true } }),
  ]);

  const candidateIds = candidates.map((c) => c.id);

  const [overdueTasks, lastActivities, exceptions, stageDurations, engagementActivities] = await Promise.all([
    candidateIds.length
      ? prisma.task.groupBy({
          by: ["clientId"],
          where: { clientId: { in: candidateIds }, status: "OVERDUE" },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    candidateIds.length
      ? prisma.activity.findMany({
          where: { clientId: { in: candidateIds } },
          orderBy: [{ clientId: "asc" }, { createdAt: "desc" }],
          distinct: ["clientId"],
          select: { clientId: true, createdAt: true },
        })
      : Promise.resolve([]),
    candidateIds.length
      ? prisma.exception.findMany({
          where: { clientId: { in: candidateIds } },
          select: { clientId: true, stageId: true, createdAt: true, resolvedAt: true },
        })
      : Promise.resolve([]),
    getStageDurations(clientFilter, stages),
    candidateIds.length
      ? prisma.activity.groupBy({
          by: ["clientId"],
          where: { clientId: { in: candidateIds }, type: { in: [...ENGAGEMENT_ACTIVITY_TYPES] } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const overdueCountByClient = new Map(overdueTasks.map((t) => [t.clientId, t._count._all]));
  const lastActivityByClient = new Map(lastActivities.map((a) => [a.clientId, a.createdAt]));
  const benchmarkByStage = new Map(stageDurations.map((d) => [d.stageId, d.avgHours]));
  const engagementCountByClient = new Map(engagementActivities.map((a) => [a.clientId, a._count._all]));

  let critical = 0;
  let atRisk = 0;
  let disengaged = 0;
  let crossSellCandidates = 0;

  const entries: WorklistEntry[] = candidates.map((client) => {
    const heldMs = exceptions
      .filter((e) => e.clientId === client.id && e.stageId === client.currentStageId)
      .reduce((sum, e) => sum + Math.max(0, (e.resolvedAt ?? now).getTime() - e.createdAt.getTime()), 0);
    const effectiveEnteredAt = effectiveStageEnteredAt(client.stageEnteredAt, heldMs);
    const slaStatus = computeSlaStatus(effectiveEnteredAt, client.currentStage.slaHours, now);
    const ageHours = stageAgeHours(effectiveEnteredAt, now);

    const lastActivityAt = lastActivityByClient.get(client.id);
    const daysSinceLastActivity = lastActivityAt
      ? Math.floor((now.getTime() - lastActivityAt.getTime()) / (1000 * 60 * 60 * 24))
      : Math.floor((now.getTime() - client.createdAt.getTime()) / (1000 * 60 * 60 * 24));

    const overdueTaskCount = overdueCountByClient.get(client.id) ?? 0;

    const priority = computePriorityScore({
      priority: client.priority,
      slaStatus,
      overdueTaskCount,
      daysSinceLastActivity,
      clientStatus: client.status,
    });

    const health = computeHealthStatus({
      slaStatus,
      stageAgeHours: ageHours,
      benchmarkAvgHours: benchmarkByStage.get(client.currentStageId) ?? null,
      daysSinceLastActivity,
    });

    // v1: display-only signal, independent of NBA/priority sort — not fed into any rules engine.
    const filledCount = PROPENSITY_PROFILE_FIELDS.filter((f) => client[f] != null).length;
    const propensity = computePropensityScore({
      leadSource: client.leadSource,
      engagementActivityCount: engagementCountByClient.get(client.id) ?? 0,
      profileFieldsFilled: filledCount,
      profileFieldsTotal: PROPENSITY_PROFILE_FIELDS.length,
      expectedInvestment: client.expectedInvestment ? Number(client.expectedInvestment) : null,
      clientType: client.clientType,
    });

    const copilotClient: CopilotClient = client;
    const nba = getNextBestAction(copilotClient);
    const crossSell = getCrossSellFlags(client);
    const messageSuggestion = suggestMessageTemplate(nba, { ...copilotClient, assignedTo: client.assignedTo }, templates);

    if (health.status === "CRITICAL") critical += 1;
    else if (health.status === "AT_RISK") atRisk += 1;
    if (daysSinceLastActivity >= 5) disengaged += 1;
    if (crossSell.length > 0) crossSellCandidates += 1;

    return {
      client: {
        id: client.id,
        name: client.name,
        clientCode: client.clientCode,
        stageName: client.currentStage.name,
        assignedToId: client.assignedToId,
      },
      priority,
      health,
      propensity,
      nba,
      crossSell,
      messageSuggestion,
      suggestedFollowUp: {
        title: nba.label,
        dueAtIso: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      },
    };
  });

  entries.sort((a, b) => b.priority.score - a.priority.score);

  return {
    entries: entries.slice(0, WORKLIST_SIZE),
    summary: { critical, atRisk, disengaged, crossSellCandidates },
  };
}
