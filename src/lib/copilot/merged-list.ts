import { prisma } from "@/lib/db/prisma";
import { buildWorklist, type WorklistEntry, type WorklistSummary } from "./worklist";
import { mergeCopilotRows, PRIORITIES, type CopilotRow } from "./list-view";

/** One list for the Co-pilot: every customer from the worklist and from the next-best-action list, once each. Reads only. */
export async function loadCopilotList(visibleUserIds: string[] | null, includeUnassigned: boolean): Promise<{ rows: CopilotRow[]; entries: Map<string, WorklistEntry>; summary: WorklistSummary }> {
  const [{ entries, summary }, intel, rms] = await Promise.all([
    buildWorklist(visibleUserIds, Number.MAX_SAFE_INTEGER),
    prisma.customerIntelligence.findMany({
      where: {
        client: {
          isDeleted: false,
          mergedIntoId: null,
          status: { not: "NOT_PROCEEDING" },
          ...(visibleUserIds ? { OR: [{ assignedToId: { in: visibleUserIds } }, ...(includeUnassigned ? [{ assignedToId: null }] : [])] } : {}),
        },
      },
      orderBy: [{ priorityScore: "desc" }, { clientId: "asc" }],
      include: { client: { select: { id: true, name: true, clientCode: true, currentStage: { select: { name: true } }, assignedTo: { select: { name: true } } } } },
    }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const rmName = new Map(rms.map((u) => [u.id, u.name]));
  const worklistRows: CopilotRow[] = entries.map((e) => ({
    clientId: e.client.id,
    name: e.client.name,
    code: e.client.clientCode,
    stage: e.client.stageName,
    rm: e.client.assignedToId ? (rmName.get(e.client.assignedToId) ?? null) : null,
    health: e.health.status,
    score: e.priority.score,
    reason: [...e.health.reasons, ...e.priority.reasons].slice(0, 3).join(" · "),
    priority: null,
    owner: null,
    when: null,
    action: e.nba.label,
    why: e.nba.detail,
  }));
  const intelRows: CopilotRow[] = intel.map((i) => ({
    clientId: i.clientId,
    name: i.client.name,
    code: i.client.clientCode,
    stage: i.client.currentStage.name,
    rm: i.client.assignedTo?.name ?? null,
    health: null,
    score: null,
    reason: "",
    priority: (PRIORITIES as readonly string[]).includes(i.nbaPriority) ? (i.nbaPriority as CopilotRow["priority"]) : null,
    owner: i.nbaOwner,
    when: i.nbaTiming,
    action: `${i.nbaProgramme}${i.nbaTopic ? ` · ${i.nbaTopic}` : ""}`,
    why: i.nbaReason,
  }));
  return { rows: mergeCopilotRows(worklistRows, intelRows), entries: new Map(entries.map((e) => [e.client.id, e])), summary };
}
