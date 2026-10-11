/**
 * Retention for AgentRun. Detail rows live until their own `retainUntil` (AI_RUN_RETENTION_DAYS when written, default 90). The job folds
 * each expired row into a daily aggregate (AgentRunRollup) and then deletes it, so cost and failure history outlives the detail.
 * It is registered in the cron tick with the existing job pattern. SEAM: when the control plane's JobRun wrapper lands, wrap
 * `runAgentRunRetention` with it under AI_RUN_RETENTION_JOB; nothing here needs to change.
 */
export const AI_RUN_RETENTION_JOB = "ai-run-retention";

export type RunStatusDb = "OK" | "ABSTAINED" | "FAILED" | "BLOCKED";
export type ExpiredRun = { id: string; createdAt: Date; agentKey: string | null; purposeId: string; status: RunStatusDb; inputTokens: number; outputTokens: number; costUsdEstimate: number; latencyMs: number };
export type RollupGroup = { day: Date; agentKey: string; purposeId: string; status: RunStatusDb; runs: number; inputTokens: number; outputTokens: number; costUsdEstimate: number; latencyMsTotal: number };

export type RetentionStore = {
  /** Up to `take` rows whose retainUntil is in the past, oldest first. */
  expired: (now: Date, take: number) => Promise<ExpiredRun[]>;
  /** Adds the groups to the rollup table and deletes the rows, atomically. */
  foldAndDelete: (groups: RollupGroup[], ids: string[]) => Promise<void>;
};

const IST_MS = 5.5 * 3600_000;
/** The Indian calendar day of an instant, as a UTC-midnight Date (what a DATE column holds). */
export const istDay = (d: Date) => new Date(Math.floor((d.getTime() + IST_MS) / 86_400_000) * 86_400_000);

export function rollupGroups(rows: ExpiredRun[]): RollupGroup[] {
  const map = new Map<string, RollupGroup>();
  for (const r of rows) {
    const day = istDay(r.createdAt);
    const agentKey = r.agentKey ?? "";
    const key = `${day.toISOString()}|${agentKey}|${r.purposeId}|${r.status}`;
    const g = map.get(key) ?? { day, agentKey, purposeId: r.purposeId, status: r.status, runs: 0, inputTokens: 0, outputTokens: 0, costUsdEstimate: 0, latencyMsTotal: 0 };
    g.runs += 1; g.inputTokens += r.inputTokens; g.outputTokens += r.outputTokens; g.costUsdEstimate += r.costUsdEstimate; g.latencyMsTotal += r.latencyMs;
    map.set(key, g);
  }
  return [...map.values()];
}

export async function pruneAgentRuns(store: RetentionStore, now: Date, opts: { batch?: number; maxBatches?: number } = {}): Promise<{ deleted: number; groups: number }> {
  const batch = opts.batch ?? 1000;
  let deleted = 0;
  let groups = 0;
  for (let i = 0; i < (opts.maxBatches ?? 20); i += 1) {
    const rows = await store.expired(now, batch);
    if (rows.length === 0) break;
    const g = rollupGroups(rows);
    await store.foldAndDelete(g, rows.map((r) => r.id));
    deleted += rows.length; groups += g.length;
    if (rows.length < batch) break;
  }
  return { deleted, groups };
}
