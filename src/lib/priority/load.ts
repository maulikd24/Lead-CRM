import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { rankPriorityClients, type PriorityClientInput, type RankedPriorityClient } from "./rank";
import type { NbaPriority } from "@/lib/intelligence/constants";

/** How many customers the Priority Clients list considers, by Next Best Action score, before ranking. */
const CANDIDATE_LIMIT = 100;
/** How many ranked customers the screen shows. */
export const PRIORITY_CLIENTS_SHOWN = 25;

const DAY = 24 * 60 * 60 * 1000;

export type PriorityClientRow = RankedPriorityClient & {
  nbaProgramme: string;
  nbaAction: string;
  nbaTopic: string | null;
  nbaReason: string;
  talkingPoints: string[];
  highAcceptance: string[];
  pendingCommitments: number;
  openComplaints: number;
  daysSinceLastInteraction: number | null;
  lifecycleStage: string;
};

type SituationJson = { key?: unknown; severity?: unknown };

function parseSituations(value: unknown): PriorityClientInput["situations"] {
  if (!Array.isArray(value)) return [];
  const out: PriorityClientInput["situations"] = [];
  for (const item of value as SituationJson[]) {
    const severity = item?.severity;
    if (typeof item?.key === "string" && (severity === "high" || severity === "medium" || severity === "info")) out.push({ key: item.key, severity });
  }
  return out;
}

function parseTalkingPoints(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Loads the inputs for the Priority Clients ranking for the customers this viewer can see, then ranks them.
 * Reads only: no writes, no outbound action. `visibleUserIds` null means everyone (admin view).
 */
export async function loadPriorityClients(
  visibleUserIds: string[] | null,
  includeUnassigned: boolean,
  now: Date = new Date(),
): Promise<PriorityClientRow[]> {
  const clientWhere: Prisma.ClientWhereInput = {
    isDeleted: false,
    mergedIntoId: null,
    status: { not: "NOT_PROCEEDING" },
    ...(visibleUserIds ? { OR: [{ assignedToId: { in: visibleUserIds } }, ...(includeUnassigned ? [{ assignedToId: null }] : [])] } : {}),
  };

  const intel = await prisma.customerIntelligence.findMany({
    where: { client: clientWhere },
    orderBy: [{ priorityScore: "desc" }, { computedAt: "desc" }],
    take: CANDIDATE_LIMIT,
    include: { client: { select: { id: true, name: true } } },
  });
  if (intel.length === 0) return [];

  const ids = intel.map((row) => row.clientId);

  const [insights, activity, acceptance] = await Promise.all([
    prisma.conversationInsight.findMany({
      where: { clientId: { in: ids }, kind: { in: ["COMMITMENT", "COMPLAINT"] }, status: "OPEN" },
      select: { clientId: true, kind: true, dueAt: true },
    }),
    prisma.activity.groupBy({
      by: ["clientId"],
      where: { clientId: { in: ids }, type: { in: ["CALL", "MESSAGE", "NOTE"] } },
      _max: { createdAt: true },
    }),
    prisma.assetClassAcceptance.findMany({
      where: { clientId: { in: ids }, level: "HIGH" },
      select: { clientId: true, assetClass: true },
    }),
  ]);

  const pendingBy = new Map<string, { pending: number; overdue: boolean; complaints: number }>();
  for (const id of ids) pendingBy.set(id, { pending: 0, overdue: false, complaints: 0 });
  for (const insight of insights) {
    const entry = pendingBy.get(insight.clientId);
    if (!entry) continue;
    if (insight.kind === "COMPLAINT") entry.complaints += 1;
    else {
      entry.pending += 1;
      if (insight.dueAt && insight.dueAt < now) entry.overdue = true;
    }
  }

  const lastContact = new Map<string, Date>();
  for (const row of activity) {
    if (row._max.createdAt) lastContact.set(row.clientId, row._max.createdAt);
  }

  const highBy = new Map<string, string[]>();
  for (const row of acceptance) highBy.set(row.clientId, [...(highBy.get(row.clientId) ?? []), row.assetClass]);

  const inputs: PriorityClientInput[] = intel.map((row) => {
    const counts = pendingBy.get(row.clientId)!;
    const last = lastContact.get(row.clientId);
    return {
      clientId: row.clientId,
      name: row.client.name,
      nba: { priority: row.nbaPriority as NbaPriority, priorityScore: row.priorityScore, programme: row.nbaProgramme },
      pendingCommitments: counts.pending,
      overdueCommitments: counts.overdue,
      openComplaints: counts.complaints,
      situations: parseSituations(row.situations),
      daysSinceLastInteraction: last ? Math.max(0, Math.floor((now.getTime() - last.getTime()) / DAY)) : null,
    };
  });

  const byId = new Map(intel.map((row) => [row.clientId, row]));
  const ranked = rankPriorityClients(inputs).slice(0, PRIORITY_CLIENTS_SHOWN);

  return ranked.map((r) => {
    const row = byId.get(r.clientId)!;
    const input = inputs.find((i) => i.clientId === r.clientId)!;
    return {
      ...r,
      nbaProgramme: row.nbaProgramme,
      nbaAction: row.nbaAction,
      nbaTopic: row.nbaTopic,
      nbaReason: row.nbaReason,
      talkingPoints: parseTalkingPoints(row.talkingPoints),
      highAcceptance: highBy.get(r.clientId) ?? [],
      pendingCommitments: input.pendingCommitments,
      openComplaints: input.openComplaints,
      daysSinceLastInteraction: input.daysSinceLastInteraction,
      lifecycleStage: row.lifecycleStage,
    };
  });
}
