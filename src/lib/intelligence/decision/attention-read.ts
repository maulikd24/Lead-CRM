// The read API the Attention Engine uses for stored decisions (Wave 2 integration): open RECOMMEND decisions, newest per customer, as facts. No reason text, no evidence.
// Who may SEE shadow decisions is decided by the caller (managers and admins within their scope; an RM only with NBA_RM_VISIBLE, as everywhere else); this only reads.
import { basePrisma } from "@/lib/db/prisma";
import { DAY_MS } from "./constants";
import { engineFlagOn } from "./enabled";

export type OpenRecommendation = { id: string; clientId: string; clientName: string; ownerId: string | null; action: string; programme: string; topic: string | null; priority: string; priorityScore: number; timing: string; confidence: string; createdAt: Date };

export async function loadOpenRecommendations(clientWhere: Record<string, unknown>, now: Date, take = 30, env: Record<string, string | undefined> = process.env): Promise<OpenRecommendation[]> {
  if (!engineFlagOn(env)) return [];
  const rows = await basePrisma.decisionRecord.findMany({
    where: { result: "RECOMMEND", status: "OPEN", createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS), lte: now }, client: { ...clientWhere, status: "ACTIVE", mergedIntoId: null } },
    select: { id: true, clientId: true, action: true, programme: true, topic: true, priority: true, priorityScore: true, timing: true, confidence: true, createdAt: true, client: { select: { name: true, assignedToId: true } } },
    orderBy: [{ priorityScore: "desc" }, { createdAt: "desc" }],
    take: take * 3,
  });
  // The newest open decision per customer (an older open one was replaced).
  const seen = new Set<string>();
  const out: OpenRecommendation[] = [];
  for (const r of [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    if (seen.has(r.clientId)) continue;
    seen.add(r.clientId);
    out.push({ id: r.id, clientId: r.clientId, clientName: r.client.name, ownerId: r.client.assignedToId, action: r.action, programme: r.programme, topic: r.topic, priority: r.priority, priorityScore: r.priorityScore, timing: r.timing, confidence: r.confidence, createdAt: r.createdAt });
  }
  return out.sort((a, b) => b.priorityScore - a.priorityScore).slice(0, take);
}
