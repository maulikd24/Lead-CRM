import { prisma } from "@/lib/db/prisma";

import { parseEvidence } from "./evidence";
import { gatewayMemoryModel } from "./model";
import { proposalsFromInsights, refineWithModel, type Drafted, type InsightRow, type MemoryModel, type RefineStatus } from "./propose";
import { writeMemoryItem } from "./store";

export const MEMORY_EXTRACTION_ENV = "MEMORY_EXTRACTION_ENABLED";
export const memoryExtractionEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env[MEMORY_EXTRACTION_ENV] === "1";

export type RunSummary = { considered: number; created: number; reaffirmed: number; suppressed: number; refused: Record<string, number>; modelCalls: number; /** How the model step ended (null: no model step ran). */ modelStatus: RefineStatus | null };

const AGENT = { type: "AI_AGENT" as const, userId: null, agentKey: "memory_extractor" };

const toRow = (i: { id: string; kind: string; assetClass: string | null; text: string; severity: string | null; dueAt: Date | null; sourceType: string; sourceRef: string; occurredAt: Date }): InsightRow => ({ id: i.id, kind: i.kind, assetClass: i.assetClass, text: i.text, severity: i.severity, dueAt: i.dueAt, sourceType: i.sourceType, sourceRef: i.sourceRef, occurredAt: i.occurredAt });

/**
 * Proposes memory items for one customer from the conversation insights that exist. Draft only: every item is created UNCONFIRMED
 * by the store (which also checks consent at derivation time and that each source belongs to this customer), and nothing here
 * contacts anyone. With a model, insights that no item cites yet are read once for preferences, facts, goals and do-not-do requests.
 * Safe to re-run: the same observation reaffirms the same item and adds no duplicate.
 */
export async function proposeMemoryForClient(clientId: string, opts: { model?: MemoryModel | null; now?: Date; limit?: number; correlationId?: string } = {}): Promise<RunSummary> {
  const now = opts.now ?? new Date();
  const summary: RunSummary = { considered: 0, created: 0, reaffirmed: 0, suppressed: 0, refused: {}, modelCalls: 0, modelStatus: null };
  const insights = (await prisma.conversationInsight.findMany({ where: { clientId }, orderBy: { occurredAt: "desc" }, take: opts.limit ?? 100 })).map(toRow);
  summary.considered = insights.length;
  if (insights.length === 0) return summary;

  const drafted: Drafted[] = [];
  // The model step runs through callModel() (purpose memory.extract) when extraction is switched on and no other model is handed in. `model: null` means deterministic mapping only.
  const model = opts.model === undefined ? (memoryExtractionEnabled() ? gatewayMemoryModel(clientId, undefined, opts.correlationId) : null) : opts.model;
  if (model) {
    const items = await prisma.customerMemoryItem.findMany({ where: { clientId }, select: { evidence: true }, take: 500 });
    const seen = new Set(items.flatMap((i) => parseEvidence(i.evidence).map((e) => e.sourceRef)));
    const unread = insights.filter((i) => !seen.has(`insight:${i.id}`));
    if (unread.length > 0) {
      summary.modelCalls = 1;
      const refined = await refineWithModel(unread, model);
      summary.modelStatus = refined.status;
      drafted.push(...refined.proposals);
    }
  }
  drafted.push(...proposalsFromInsights(insights));

  for (const d of drafted) {
    const r = await writeMemoryItem({ ...d.proposal, clientId, actor: AGENT, now, correlationId: opts.correlationId });
    if (!r.ok) summary.refused[r.code] = (summary.refused[r.code] ?? 0) + 1;
    else if (r.outcome === "created") summary.created++;
    else if (r.outcome === "reaffirmed") summary.reaffirmed++;
    else summary.suppressed++;
  }
  return summary;
}

/** The batch the scheduler can call (flag MEMORY_EXTRACTION_ENABLED): customers whose newest insight is newer than their newest memory item. */
export async function runMemoryExtractionBatch(opts: { model?: MemoryModel | null; now?: Date; maxClients?: number } = {}): Promise<{ clients: number; created: number }> {
  if (!memoryExtractionEnabled()) return { clients: 0, created: 0 };
  const recent = await prisma.conversationInsight.groupBy({ by: ["clientId"], _max: { createdAt: true }, orderBy: { _max: { createdAt: "desc" } }, take: (opts.maxClients ?? 20) * 3 });
  let clients = 0;
  let created = 0;
  for (const r of recent) {
    if (clients >= (opts.maxClients ?? 20)) break;
    const last = await prisma.customerMemoryItem.aggregate({ where: { clientId: r.clientId }, _max: { createdAt: true } });
    if (last._max.createdAt && r._max.createdAt && last._max.createdAt >= r._max.createdAt) continue;
    const s = await proposeMemoryForClient(r.clientId, { model: opts.model, now: opts.now });
    clients++;
    created += s.created;
  }
  return { clients, created };
}
