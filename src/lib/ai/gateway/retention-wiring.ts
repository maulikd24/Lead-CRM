import { basePrisma } from "@/lib/db/prisma";

import { AI_RUN_RETENTION_JOB, pruneAgentRuns, type ExpiredRun, type RetentionStore, type RunStatusDb } from "./retention";

export const retentionStore: RetentionStore = {
  expired: async (now, take) => {
    const rows = await basePrisma.agentRun.findMany({
      where: { retainUntil: { lt: now } }, orderBy: { retainUntil: "asc" }, take,
      select: { id: true, createdAt: true, agentKey: true, purposeId: true, status: true, inputTokens: true, outputTokens: true, costUsdEstimate: true, latencyMs: true },
    });
    return rows.map((r): ExpiredRun => ({ ...r, status: r.status as RunStatusDb, costUsdEstimate: Number(r.costUsdEstimate) }));
  },
  foldAndDelete: async (groups, ids) => {
    await basePrisma.$transaction([
      ...groups.map((g) =>
        basePrisma.agentRunRollup.upsert({
          where: { day_agentKey_purposeId_status: { day: g.day, agentKey: g.agentKey, purposeId: g.purposeId, status: g.status } },
          create: { day: g.day, agentKey: g.agentKey, purposeId: g.purposeId, status: g.status, runs: g.runs, inputTokens: g.inputTokens, outputTokens: g.outputTokens, costUsdEstimate: g.costUsdEstimate, latencyMsTotal: g.latencyMsTotal },
          update: { runs: { increment: g.runs }, inputTokens: { increment: g.inputTokens }, outputTokens: { increment: g.outputTokens }, costUsdEstimate: { increment: g.costUsdEstimate }, latencyMsTotal: { increment: g.latencyMsTotal } },
        }),
      ),
      basePrisma.agentRun.deleteMany({ where: { id: { in: ids } } }),
    ]);
  },
};

/** Cron entry (existing job pattern). Returns counts only. */
export async function runAgentRunRetention(now: Date = new Date()) {
  return { job: AI_RUN_RETENTION_JOB, ...(await pruneAgentRuns(retentionStore, now)) };
}
