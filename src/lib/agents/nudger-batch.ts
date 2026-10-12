import { PROVIDER_ERROR_REASON, NUDGER_KEY, type DraftResult } from "./nudger";

export type BatchCounts = { drafted: number; blocked: number; skipped: number; failed: number };

export type BatchDeps = {
  isEnabled: () => Promise<boolean>;
  /** Customer ids to consider, best candidates first. Only called after the enabled check passes. */
  loadCandidates: (limit: number) => Promise<string[]>;
  /**
   * Records that this customer was considered now, whatever happens next. Called BEFORE draft so a customer that crashes or
   * times out still rotates to the back of the queue instead of being retried first on every tick.
   */
  markConsidered: (clientId: string, now: Date) => Promise<void>;
  draft: (clientId: string) => Promise<DraftResult>;
  now: () => Date;
};

/** A vendor that is down, out of quota or rejecting our key fails every call; stop rather than hammer it for the rest of the batch. */
export const PROVIDER_FAILURE_STOP = 3;

/**
 * Cron entry point for the draft-only nudger. Sequential on purpose (vendor rate limits, and one slow customer must not
 * fan out). Never throws for a single customer; a throwing candidate loader propagates so the cron wrapper can report it.
 * Writes only AgentProposal rows (DRAFT/BLOCKED). The briefing is built with persist:false, so no intelligence rows are written and
 * no journey trigger can fire; there is no send path in this module. Sending happens only through a human approval (decide.ts).
 */
/** No NEW customer is started once this much wall-clock time has passed: a tick has maxDuration 300 s and one draft can take ~40 s with a retry plus the judge. */
export const DEFAULT_BUDGET_MS = 90_000;

export async function runNudgerBatch(limit = 10, deps?: BatchDeps, budgetMs = DEFAULT_BUDGET_MS): Promise<BatchCounts> {
  const counts: BatchCounts = { drafted: 0, blocked: 0, skipped: 0, failed: 0 };
  const d = deps ?? (await import("./wiring")).batchDeps();
  if (!(await d.isEnabled())) return counts;

  const ids = (await d.loadCandidates(limit)).slice(0, limit);
  let providerFailures = 0;
  const startedAt = d.now().getTime();
  for (const id of ids) {
    if (d.now().getTime() - startedAt >= budgetMs) break;
    let result: DraftResult;
    try {
      await d.markConsidered(id, d.now());
      result = await d.draft(id);
    } catch (error) {
      console.error(`${NUDGER_KEY}: drafting failed for client ${id}`, error);
      counts.failed += 1;
      providerFailures = 0;
      continue;
    }
    if (result.status === "drafted") counts.drafted += 1;
    else if (result.status === "blocked") counts.blocked += 1;
    else counts.skipped += 1;

    providerFailures = result.status === "skipped" && result.reason === PROVIDER_ERROR_REASON ? providerFailures + 1 : 0;
    if (providerFailures >= PROVIDER_FAILURE_STOP) {
      console.error(`${NUDGER_KEY}: ${PROVIDER_FAILURE_STOP} consecutive provider failures, stopping this batch`);
      break;
    }
  }
  return counts;
}
