// Database side of the replay: as-of input loading, the shared run used by the CLI script and the admin page, and storage of the summary.
import { basePrisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { loadCustomerFacts } from "../facts";
import { computeIntelligence } from "../refresh";
import { DAY_MS } from "./constants";
import { loadDecisionInput, type DecisionInput } from "./loader";
import { loadLaterEvents } from "./outcomes-db";
import { replay, rewindFacts, snapshotDates, type ReplayPoint, type ReplayReport } from "./replay";

export async function loadHistoricalInput(clientId: string, asOf: Date): Promise<DecisionInput | null> {
  const facts = await loadCustomerFacts(clientId, asOf);
  if (!facts) return null;
  const last = await basePrisma.activity.findFirst({ where: { clientId, createdAt: { lte: asOf } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const rewound = rewindFacts(facts, asOf, last?.createdAt ?? null);
  return loadDecisionInput(clientId, { now: asOf, result: computeIntelligence(rewound) });
}

export type ReplayParams = { clients: number; snapshots: number; stepDays: number; minAgeDays: number; outcomeWindowDays: number };
export const DEFAULT_REPLAY: ReplayParams = { clients: 200, snapshots: 4, stepDays: 7, minAgeDays: 8, outcomeWindowDays: 7 };

export async function runReplay(params: Partial<ReplayParams> = {}, now = new Date()): Promise<ReplayReport & { clientsUsed: number }> {
  const p = { ...DEFAULT_REPLAY, ...params };
  const clients = await basePrisma.client.findMany({ where: { isDeleted: false, mergedIntoId: null, createdAt: { lte: new Date(now.getTime() - p.minAgeDays * DAY_MS) } }, select: { id: true }, orderBy: { id: "asc" }, take: p.clients });
  const dates = snapshotDates(now, p.snapshots, p.stepDays, p.minAgeDays);
  const points: ReplayPoint[] = clients.flatMap((c) => dates.map((asOf) => ({ clientId: c.id, asOf })));
  const report = await replay(points, { loadInput: loadHistoricalInput, laterEvents: loadLaterEvents, now }, { outcomeWindowDays: p.outcomeWindowDays });
  return { ...report, clientsUsed: clients.length };
}

export async function saveReplayRun(params: Partial<ReplayParams>, report: ReplayReport, createdById: string | null): Promise<string> {
  const row = await basePrisma.decisionReplayRun.create({ data: { createdById, params: { ...DEFAULT_REPLAY, ...params } as unknown as Prisma.InputJsonValue, summary: report as unknown as Prisma.InputJsonValue }, select: { id: true } });
  return row.id;
}

export async function latestReplayRun(): Promise<{ id: string; createdAt: Date; params: ReplayParams; summary: ReplayReport } | null> {
  const row = await basePrisma.decisionReplayRun.findFirst({ orderBy: { createdAt: "desc" } });
  return row ? { id: row.id, createdAt: row.createdAt, params: row.params as unknown as ReplayParams, summary: row.summary as unknown as ReplayReport } : null;
}
