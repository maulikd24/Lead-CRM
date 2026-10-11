import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db/prisma";
import { emitAgentRun, emitAutopilotRecommended } from "@/lib/events/producers-emit";

import { runAudit, shouldRunDaily, type AuditDeps, type AuditEvent } from "./audit";
import * as store from "./store";

/** Production wiring of the audit: the database store, the registered system reader "autopilot" for outcomes, and the event emitters. */
export const AUTOPILOT_AGENT_KEY = "ad_autopilot";

const emitAuditEvent = async (e: AuditEvent): Promise<void> => {
  if (e.type === "recommended") { await emitAutopilotRecommended({ recId: e.recId, correlationId: e.correlationId, auditRunId: e.auditRunId, actionKind: e.actionKind, severity: e.severity }); return; }
  const kind = e.type === "agent.run.started" ? "started" : e.type === "agent.run.completed" ? "completed" : "failed";
  await emitAgentRun(kind, { agentKey: AUTOPILOT_AGENT_KEY, runId: e.runId, correlationId: e.correlationId, outcome: e.outcome, errorClass: e.errorClass });
};

export function auditDeps(): AuditDeps {
  return {
    now: () => new Date(),
    listRules: store.listRules,
    recentDenials: store.recentDenials,
    loadSnapshot: (ruleWindows) => store.loadSnapshot({ caller: { kind: "system", consumer: "autopilot" }, ruleWindows }),
    createRun: async (trigger, startedById) => {
      const row = await prisma.autopilotAuditRun.create({ data: { correlationId: randomUUID(), trigger, startedById }, select: { id: true, correlationId: true } });
      return row;
    },
    finishRun: async (id, patch) => {
      await prisma.autopilotAuditRun.update({ where: { id }, data: { ...patch, finishedAt: new Date() } });
    },
    syncRecommendations: (fresh, run, now) => store.syncRecommendations(fresh, run, now),
    expireStale: store.expireStale,
    emit: emitAuditEvent,
  };
}

export async function latestAuditRun() {
  return prisma.autopilotAuditRun.findFirst({ where: { status: "SUCCEEDED" }, orderBy: { startedAt: "desc" }, select: { id: true, trigger: true, startedAt: true, finishedAt: true, healthScore: true, proposals: true, newProposals: true, wastedSpend: true, dataThrough: true, correlationId: true } });
}

/** The cron job: once a day, flagged, wrapped by runJob in the tick. Returns counts only (the control plane stores numbers, never content). */
export async function runDailyAuditJob(env: Record<string, string | undefined> = process.env, now: Date = new Date()): Promise<Record<string, number | boolean>> {
  if (env.NEXT_PUBLIC_AUTOPILOT !== "1" || env.AUTOPILOT_DAILY_AUDIT_ENABLED !== "1") return { skipped: true };
  const last = await prisma.autopilotAuditRun.findFirst({ where: { trigger: "job", status: "SUCCEEDED" }, orderBy: { startedAt: "desc" }, select: { startedAt: true } });
  if (!shouldRunDaily(last?.startedAt ?? null, now)) return { skipped: true, ranToday: true };
  const res = await runAudit(auditDeps(), { trigger: "job" });
  if (!res.ok) throw Object.assign(new Error("Autopilot audit failed"), { name: res.errorClass });
  return { ran: true, proposals: res.proposals, newProposals: res.newProposals, open: res.open, expired: res.expired, ...(res.healthScore === null ? {} : { healthScore: res.healthScore }) };
}

/** A person opened Autopilot and the newest audit is stale (older than six hours) or missing: run one now, attributed to nobody (the page is not an actor). */
export async function ensureFreshAudit(opts: { force?: boolean; startedById?: string | null; now?: Date } = {}): Promise<void> {
  const now = opts.now ?? new Date();
  const last = await latestAuditRun();
  if (!opts.force && last && now.getTime() - last.startedAt.getTime() < 6 * 3_600_000) return;
  await runAudit(auditDeps(), { trigger: "page", startedById: opts.startedById ?? null });
}
