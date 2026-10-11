import { basePrisma } from "@/lib/db/prisma";

import { budgetDayStart } from "./gateway";
import { buildAiPanel, type AiPanel, type RawRow } from "./panel";

const DAY = 86_400_000;

/** Reads what the AI tab shows. Aggregates only: it never selects a prompt, an output or a subject. */
export async function loadAiPanel(env: NodeJS.ProcessEnv = process.env, now: Date = new Date(), windowDays = 7): Promise<AiPanel> {
  const since = new Date(now.getTime() - windowDays * DAY);
  const [window, today, settings, autonomy, oldest] = await Promise.all([
    basePrisma.$queryRaw<Array<{ purposeId: string; agentKey: string | null; status: RawRow["status"]; runs: number; inputTokens: number; outputTokens: number; costUsd: number; p50Ms: number | null; p95Ms: number | null }>>`
      SELECT "purposeId", "agentKey", "status"::text AS "status", count(*)::int AS "runs", coalesce(sum("inputTokens"),0)::int AS "inputTokens", coalesce(sum("outputTokens"),0)::int AS "outputTokens",
             coalesce(sum("costUsdEstimate"),0)::float AS "costUsd",
             percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs")::float AS "p50Ms", percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs")::float AS "p95Ms"
      FROM "AgentRun" WHERE "createdAt" >= ${since} GROUP BY "purposeId", "agentKey", "status"`,
    basePrisma.agentRun.groupBy({ by: ["purposeId"], where: { createdAt: { gte: budgetDayStart(now) } }, _sum: { costUsdEstimate: true } }),
    basePrisma.agentSetting.findMany({ select: { agentKey: true, enabled: true } }),
    basePrisma.agentAutonomy.findMany({ select: { agentKey: true, actionType: true, level: true } }),
    basePrisma.agentRun.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  return buildAiPanel({
    now, windowDays, env,
    window: window.map((r) => ({ ...r, status: r.status })),
    today: today.map((t) => ({ purposeId: t.purposeId, costUsd: Number(t._sum.costUsdEstimate ?? 0) })),
    settings, autonomy, oldestRun: oldest?.createdAt ?? null,
  });
}
