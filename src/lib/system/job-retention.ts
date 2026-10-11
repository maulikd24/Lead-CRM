/**
 * Retention for JobRun and resolved ControlPlaneAlert rows. Detail is short-lived because the screens only need 7 days of rates;
 * failures are kept longer because that is what an Admin goes back to. The newest row of every job is always kept (so "last run"
 * never goes blank), open alerts are never deleted, and each tick deletes at most TICK_BATCH rows so the prune can never take the
 * database down. The planning is pure; the SQL is in job-retention-db.ts and proved by job-run.db.test.ts.
 */
export const RETENTION_DAYS = { skipped: 3, okCron: 14, okWebhook: 7, bad: 90, resolvedAlerts: 180 } as const;
export const TICK_BATCH = 5000;

export type PruneRule = { name: string; statuses: string[]; kinds?: string[]; olderThan: Date; keepNewestPerJob: true };

export interface RetentionStore {
  deleteRuns(rule: PruneRule, limit: number): Promise<number>;
  deleteResolvedAlerts(olderThan: Date, limit: number): Promise<number>;
}

const DAY = 86_400_000;
const before = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

export function planPrune(now: Date): PruneRule[] {
  return [
    { name: "skipped", statuses: ["SKIPPED"], olderThan: before(now, RETENTION_DAYS.skipped), keepNewestPerJob: true },
    { name: "ok-cron", statuses: ["OK"], kinds: ["CRON", "MANUAL", "RETRY"], olderThan: before(now, RETENTION_DAYS.okCron), keepNewestPerJob: true },
    { name: "ok-webhook", statuses: ["OK"], kinds: ["WEBHOOK"], olderThan: before(now, RETENTION_DAYS.okWebhook), keepNewestPerJob: true },
    { name: "bad", statuses: ["FAILED", "TIMEOUT", "ABANDONED", "REJECTED"], olderThan: before(now, RETENTION_DAYS.bad), keepNewestPerJob: true },
  ];
}

export async function pruneJobRuns(store: RetentionStore, now = new Date()): Promise<{ runs: number; alerts: number }> {
  let budget = TICK_BATCH;
  let runs = 0;
  for (const rule of planPrune(now)) {
    if (budget <= 0) break;
    const n = await store.deleteRuns(rule, budget);
    runs += n;
    budget -= n;
  }
  const alerts = await store.deleteResolvedAlerts(before(now, RETENTION_DAYS.resolvedAlerts), 500);
  return { runs, alerts };
}
