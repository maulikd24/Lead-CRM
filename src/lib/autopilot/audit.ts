import { evaluateControls } from "./controls";
import { buildRecommendations, tuneFromDenials, withoutSuppressed, type Decision, type Recommendation } from "./recommendations";
import { runRules, type Rule } from "./rules";
import { scoreControls } from "./scoring";
import type { AutopilotSnapshot } from "./types";
import { wastedSpend } from "./waste";

/**
 * The audit: read the snapshot (campaign outcomes come from the provider, see store.ts), evaluate the controls and the rules, and PROPOSE. One run has one
 * correlation id; every proposal it creates carries it, and so does every event, decision and applied action that follows (Action Ledger ready). The audit has
 * no ad-account access at all (no action provider is passed to it): it records proposals and facts. Database, clock and events are injected, so the whole
 * thing is tested without them. The scheduled job (audit-job.ts) and a person's refresh both call it.
 */
export type AuditEvent =
  | { type: "agent.run.started" | "agent.run.completed" | "agent.run.failed"; runId: string; correlationId: string; outcome?: string; errorClass?: string }
  | { type: "recommended"; recId: string; correlationId: string; auditRunId: string; actionKind: string; severity: string };

export type AuditRun = { id: string; correlationId: string };

export type AuditDeps = {
  now: () => Date;
  listRules: () => Promise<Rule[]>;
  recentDenials: () => Promise<Decision[]>;
  loadSnapshot: (ruleWindows: number[]) => Promise<AutopilotSnapshot>;
  createRun: (trigger: "job" | "page", startedById: string | null) => Promise<AuditRun>;
  finishRun: (id: string, patch: { status: "SUCCEEDED" | "FAILED"; dataThrough?: Date | null; healthScore?: number | null; proposals?: number; newProposals?: number; wastedSpend?: number | null; error?: string | null }) => Promise<void>;
  syncRecommendations: (fresh: Recommendation[], run: AuditRun, now: Date) => Promise<{ recs: Recommendation[]; created: string[] }>;
  expireStale: (now: Date) => Promise<number>;
  /** Best effort: an event that cannot be stored never fails the audit. */
  emit: (e: AuditEvent) => Promise<void>;
};

export type AuditResult =
  | { ok: true; runId: string; correlationId: string; proposals: number; newProposals: number; open: number; expired: number; healthScore: number | null; recs: Recommendation[] }
  | { ok: false; runId: string; correlationId: string; errorClass: string };

const safe = async (deps: AuditDeps, e: AuditEvent) => { try { await deps.emit(e); } catch { /* never the audit's problem */ } };
/** The class of a failure, never its message: a driver message can carry a connection string or a person's data. */
const classOf = (e: unknown) => (e instanceof Error && /^[A-Za-z0-9_]{1,60}$/.test(e.name) && e.name !== "Error" ? e.name : "Error");

export async function runAudit(deps: AuditDeps, opts: { trigger: "job" | "page"; startedById?: string | null }): Promise<AuditResult> {
  const now = deps.now();
  const run = await deps.createRun(opts.trigger, opts.startedById ?? null);
  await safe(deps, { type: "agent.run.started", runId: run.id, correlationId: run.correlationId });
  try {
    const rules = await deps.listRules();
    const windows = [...new Set(rules.filter((r) => r.enabled).map((r) => r.days))];
    const snap = await deps.loadSnapshot(windows);
    const results = evaluateControls(snap);
    const score = scoreControls(results);
    const waste = wastedSpend(snap);
    const fresh = [...buildRecommendations(snap, results), ...runRules(snap, rules).proposals];
    const { recs, created } = await deps.syncRecommendations(fresh, run, now);
    const expired = await deps.expireStale(now);
    const tuning = tuneFromDenials(await deps.recentDenials(), now);
    const open = withoutSuppressed(recs, tuning, now).filter((r) => r.status === "PENDING");
    for (const id of created) {
      const r = recs.find((x) => x.id === id);
      if (r) await safe(deps, { type: "recommended", recId: id, correlationId: run.correlationId, auditRunId: run.id, actionKind: r.action.kind, severity: r.severity });
    }
    await deps.finishRun(run.id, { status: "SUCCEEDED", dataThrough: snap.dataThrough ? new Date(snap.dataThrough) : null, healthScore: score.score, proposals: fresh.length, newProposals: created.length, wastedSpend: waste.wasted });
    await safe(deps, { type: "agent.run.completed", runId: run.id, correlationId: run.correlationId, outcome: "ok" });
    return { ok: true, runId: run.id, correlationId: run.correlationId, proposals: fresh.length, newProposals: created.length, open: open.length, expired, healthScore: score.score, recs };
  } catch (error) {
    const errorClass = classOf(error);
    await deps.finishRun(run.id, { status: "FAILED", error: errorClass }).catch(() => undefined);
    await safe(deps, { type: "agent.run.failed", runId: run.id, correlationId: run.correlationId, errorClass });
    return { ok: false, runId: run.id, correlationId: run.correlationId, errorClass };
  }
}

/** Once a day: run unless a scheduled run succeeded in the last 20 hours. The cron tick calls the job every tick; this decides. */
export function shouldRunDaily(lastSuccessAt: Date | null, now: Date): boolean {
  return lastSuccessAt === null || now.getTime() - lastSuccessAt.getTime() >= 20 * 3_600_000;
}
