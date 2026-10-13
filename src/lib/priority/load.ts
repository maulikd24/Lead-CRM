import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { rankPriorityClients, type PriorityClientInput, type RankedPriorityClient } from "./rank";
import { ASSET_CLASSES, SEGMENTS, type Level, type NbaPriority } from "@/lib/intelligence/constants";
import { blockedClassesFrom, buildTalkingPoints, doNotDiscussList, summariseInteraction, type DeclineRow, type LatestEvent } from "./detail";
import { aiTalkingPointsAvailable, rewriteTalkingPoints } from "./talking-points-ai";

/** How many customers the Priority Clients list considers, by Next Best Action score, before ranking. */
const CANDIDATE_LIMIT = 100;
/** How many ranked customers the screen shows. */
export const PRIORITY_CLIENTS_SHOWN = 25;
/** How many High-tier cards get the optional AI rewrite of their talking points on one load. Bounds model calls. */
export const AI_REWRITE_LIMIT = 5;

const DAY = 24 * 60 * 60 * 1000;

export type PriorityClientDetail = {
  snapshot: { lifecycleStage: string; segment: string; segments: string[]; assignedTo: string | null };
  /** One line from CustomerEvent rows: last interaction and recent activity count. */
  lastInteraction: string;
  commitments: { text: string; dueAtIso: string | null; overdue: boolean }[];
  /** Every asset class with its level, not only High. */
  acceptance: { assetClass: string; level: Level; reason: string }[];
  nba: { programme: string; action: string; topic: string | null; reason: string };
  talkingPoints: string[];
  talkingPointsSource: "template" | "ai";
  doNotDiscuss: string[];
};

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
  detail: PriorityClientDetail;
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

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

/**
 * Loads the inputs for the Priority Clients ranking for the customers this viewer can see, then ranks them, then adds
 * the per-customer detail for each shown card. Reads only: no writes, no outbound action.
 * `visibleUserIds` null means everyone (admin view). The rank order depends only on the ranking inputs, never on the AI.
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
    include: { client: { select: { id: true, name: true, customerCategory: true, investmentCategory: true, assignedTo: { select: { name: true } } } } },
  });
  if (intel.length === 0) return [];

  const ids = intel.map((row) => row.clientId);
  const monthAgo = new Date(now.getTime() - 30 * DAY);

  const [insights, activity, latestEvents, eventCounts, acceptance, declines, segments] = await Promise.all([
    prisma.conversationInsight.findMany({
      where: { clientId: { in: ids }, kind: { in: ["COMMITMENT", "COMPLAINT"] }, status: "OPEN" },
      select: { id: true, clientId: true, kind: true, text: true, dueAt: true },
      orderBy: [{ dueAt: "asc" }, { occurredAt: "desc" }],
    }),
    prisma.activity.groupBy({
      by: ["clientId"],
      where: { clientId: { in: ids }, type: { in: ["CALL", "MESSAGE", "NOTE"] } },
      _max: { createdAt: true },
    }),
    prisma.customerEvent.findMany({
      where: { clientId: { in: ids }, occurredAt: { lte: now } },
      distinct: ["clientId"],
      orderBy: [{ clientId: "asc" }, { occurredAt: "desc" }],
      select: { clientId: true, eventType: true, occurredAt: true, actorType: true },
    }),
    prisma.customerEvent.groupBy({
      by: ["clientId"],
      where: { clientId: { in: ids }, occurredAt: { gte: monthAgo, lte: now } },
      _count: { _all: true },
    }),
    prisma.assetClassAcceptance.findMany({
      where: { clientId: { in: ids } },
      select: { clientId: true, assetClass: true, level: true, reason: true },
    }),
    prisma.interactionOutcome.findMany({
      where: { clientId: { in: ids }, outcome: "NOT_INTERESTED", createdAt: { gte: monthAgo, lte: now } },
      select: { clientId: true, assetClass: true, createdAt: true },
    }),
    prisma.segmentMembership.findMany({
      where: { clientId: { in: ids }, exitedAt: null },
      select: { clientId: true, segment: true },
    }),
  ]);

  const pendingBy = new Map<string, { pending: number; overdue: boolean; complaints: number; commitments: { text: string; dueAt: Date | null; overdue: boolean }[] }>();
  for (const id of ids) pendingBy.set(id, { pending: 0, overdue: false, complaints: 0, commitments: [] });
  for (const insight of insights) {
    const entry = pendingBy.get(insight.clientId);
    if (!entry) continue;
    if (insight.kind === "COMPLAINT") entry.complaints += 1;
    else {
      entry.pending += 1;
      const overdue = !!insight.dueAt && insight.dueAt < now;
      if (overdue) entry.overdue = true;
      entry.commitments.push({ text: insight.text, dueAt: insight.dueAt, overdue });
    }
  }

  const lastContact = new Map<string, Date>();
  for (const row of activity) {
    if (row._max.createdAt) lastContact.set(row.clientId, row._max.createdAt);
  }

  const latestBy = new Map<string, LatestEvent>();
  for (const e of latestEvents) latestBy.set(e.clientId as string, { eventType: e.eventType, occurredAt: e.occurredAt, actorType: e.actorType });
  const countBy = new Map<string, number>(eventCounts.map((row) => [row.clientId as string, row._count._all]));

  const acceptanceBy = new Map<string, { assetClass: string; level: Level; reason: string }[]>();
  for (const row of acceptance) {
    acceptanceBy.set(row.clientId, [...(acceptanceBy.get(row.clientId) ?? []), { assetClass: row.assetClass, level: row.level as Level, reason: row.reason }]);
  }
  const declinesBy = new Map<string, DeclineRow[]>();
  for (const row of declines) {
    declinesBy.set(row.clientId, [...(declinesBy.get(row.clientId) ?? []), { assetClass: row.assetClass, createdAt: row.createdAt }]);
  }
  const segmentsBy = new Map<string, string[]>();
  for (const row of segments) {
    segmentsBy.set(row.clientId, [...(segmentsBy.get(row.clientId) ?? []), (SEGMENTS as Record<string, string>)[row.segment] ?? row.segment]);
  }

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

  const rows: PriorityClientRow[] = ranked.map((r) => {
    const row = byId.get(r.clientId)!;
    const input = inputs.find((i) => i.clientId === r.clientId)!;
    const counts = pendingBy.get(r.clientId)!;
    const accept = ASSET_CLASSES.flatMap((assetClass) => {
      const found = acceptanceBy.get(r.clientId)?.find((a) => a.assetClass === assetClass);
      return found ? [found] : [];
    });
    const declined = declinesBy.get(r.clientId) ?? [];
    const nbaDoNotDiscuss = stringList(row.doNotDiscuss);
    const doNotDiscuss = doNotDiscussList({
      openComplaints: input.openComplaints,
      declines: declined,
      programme: row.nbaProgramme,
      nbaReason: row.nbaReason,
      nbaDoNotDiscuss,
      now,
    });
    const blockedClasses = blockedClassesFrom(doNotDiscuss, declined, ASSET_CLASSES, now);
    const latest = latestBy.get(r.clientId) ?? null;
    const highAcceptance = accept.filter((a) => a.level === "HIGH").map((a) => a.assetClass);
    const talkingPoints = buildTalkingPoints({
      commitments: counts.commitments,
      lastInteraction: latest,
      highAcceptance: accept.filter((a) => a.level === "HIGH"),
      nbaTalkingPoints: stringList(row.talkingPoints),
      blockedClasses,
      now,
    });
    const snapshotSegments = segmentsBy.get(r.clientId) ?? [];

    return {
      ...r,
      nbaProgramme: row.nbaProgramme,
      nbaAction: row.nbaAction,
      nbaTopic: row.nbaTopic,
      nbaReason: row.nbaReason,
      talkingPoints,
      highAcceptance,
      pendingCommitments: input.pendingCommitments,
      openComplaints: input.openComplaints,
      daysSinceLastInteraction: input.daysSinceLastInteraction,
      lifecycleStage: row.lifecycleStage,
      detail: {
        snapshot: {
          lifecycleStage: row.lifecycleStage,
          segment: row.client.customerCategory ?? row.client.investmentCategory ?? "Not set",
          segments: snapshotSegments,
          assignedTo: row.client.assignedTo?.name ?? null,
        },
        lastInteraction: summariseInteraction(latest, countBy.get(r.clientId) ?? 0),
        commitments: counts.commitments.map((c) => ({ text: c.text, dueAtIso: c.dueAt?.toISOString() ?? null, overdue: c.overdue })),
        acceptance: accept,
        nba: { programme: row.nbaProgramme, action: row.nbaAction, topic: row.nbaTopic, reason: row.nbaReason },
        talkingPoints,
        talkingPointsSource: "template",
        doNotDiscuss,
      },
    };
  });

  await addAiTalkingPoints(rows, now);
  return rows;
}

/**
 * Replaces the talking points of up to AI_REWRITE_LIMIT High-tier cards with the model's rewrite, when a provider key
 * is configured. Each call falls back on its own; a failure leaves the template points in place.
 */
async function addAiTalkingPoints(rows: PriorityClientRow[], now: Date): Promise<void> {
  if (!aiTalkingPointsAvailable()) return;
  const targets = rows.filter((r) => r.tier === "High").slice(0, AI_REWRITE_LIMIT);
  await Promise.all(
    targets.map(async (row) => {
      const facts = [
        `Next best action: ${row.nbaProgramme} (${row.nbaAction})`,
        row.detail.lastInteraction,
        ...row.detail.commitments.map((c) => `Open commitment${c.overdue ? " (overdue)" : ""}${c.dueAtIso ? ` due ${c.dueAtIso.slice(0, 10)}` : ""}`),
        `Lifecycle stage: ${row.lifecycleStage}`,
        ...row.highAcceptance.map((c) => `High acceptance: ${c}`),
      ].filter(Boolean);
      const blocked = blockedClassesFrom(row.detail.doNotDiscuss, [], ASSET_CLASSES, now);
      const rewritten = await rewriteTalkingPoints({ clientId: row.clientId, points: row.talkingPoints, facts, blockedClasses: blocked });
      if (rewritten) {
        row.talkingPoints = rewritten;
        row.detail.talkingPoints = rewritten;
        row.detail.talkingPointsSource = "ai";
      }
    }),
  );
}
