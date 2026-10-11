import { prisma } from "@/lib/db/prisma";

import type { JobRaw, JobStats, LatestRun } from "./control-plane-model";
import type { FeedStats } from "./integration-status";

/**
 * Every read the control plane makes, as bounded queries: each reads an index range (job + startedAt, status + startedAt, startedAt),
 * has a LIMIT or a GROUP BY over at most 7 days, and is wrapped in a 3 second budget. Nothing scans a JSON column. No query selects a
 * message, a payload or a customer column.
 */
const DAY = 86_400_000;
export const PANEL_BUDGET_MS = 3000;

export class PanelTimeout extends Error {
  constructor() { super("Panel query timed out"); this.name = "PanelTimeout"; }
}

export function withBudget<T>(p: Promise<T>, ms = PANEL_BUDGET_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new PanelTimeout()), ms); })]).finally(() => timer && clearTimeout(timer));
}

/** The JobRun tables are not installed (migration not applied): Prisma P2021, or a raw query reporting a missing relation. */
export function isMissingTable(error: unknown): boolean {
  const e = error as { code?: string; message?: string; meta?: { code?: string } } | null;
  if (!e) return false;
  return e.code === "P2021" || e.meta?.code === "42P01" || /relation "(JobRun|ControlPlaneAlert)" does not exist/i.test(e.message ?? "");
}

/** A short class name for the screen: never the driver's message (it can carry a connection string). */
export function safeErrorClass(error: unknown): string {
  if (error instanceof PanelTimeout) return "Timeout";
  if (isMissingTable(error)) return "TablesMissing";
  return error instanceof Error && error.name ? error.name.slice(0, 60) : "Error";
}

type LatestRow = { job: string; status: string; startedAt: Date; durationMs: number | null; errorClass: string | null; skipReason: string | null; attempt: number };

export async function latestPerJob(now: Date): Promise<Map<string, LatestRun>> {
  const rows = await prisma.$queryRaw<LatestRow[]>`
    SELECT DISTINCT ON ("job") "job", "status", "startedAt", "durationMs", "errorClass", "skipReason", "attempt"
    FROM "JobRun" WHERE "startedAt" > ${new Date(now.getTime() - 14 * DAY)} AND "status" <> 'RUNNING' AND "job" <> '__tick'
    ORDER BY "job", "startedAt" DESC`;
  return new Map(rows.map((r) => [r.job, { status: r.status, startedAt: r.startedAt, durationMs: r.durationMs, errorClass: r.errorClass, skipReason: r.skipReason, attempt: r.attempt }]));
}

export async function statsPerJob(now: Date): Promise<Map<string, JobStats>> {
  const d1 = new Date(now.getTime() - DAY);
  const d7 = new Date(now.getTime() - 7 * DAY);
  const rows = await prisma.$queryRaw<{ job: string; ok24: number; bad24: number; ok7: number; bad7: number; lastOkAt: Date | null; lastAliveAt: Date | null }[]>`
    SELECT "job",
      (count(*) FILTER (WHERE "status" = 'OK' AND "startedAt" > ${d1}))::int AS "ok24",
      (count(*) FILTER (WHERE "status" IN ('FAILED','TIMEOUT') AND "startedAt" > ${d1}))::int AS "bad24",
      (count(*) FILTER (WHERE "status" = 'OK'))::int AS "ok7",
      (count(*) FILTER (WHERE "status" IN ('FAILED','TIMEOUT')))::int AS "bad7",
      max("startedAt") FILTER (WHERE "status" = 'OK') AS "lastOkAt",
      max("startedAt") FILTER (WHERE "status" IN ('OK','SKIPPED')) AS "lastAliveAt"
    FROM "JobRun" WHERE "startedAt" > ${d7} AND "job" <> '__tick' GROUP BY "job"`;
  return new Map(rows.map((r) => [r.job, { ok24: r.ok24, bad24: r.bad24, ok7: r.ok7, bad7: r.bad7, lastOkAt: r.lastOkAt, lastAliveAt: r.lastAliveAt }]));
}

/** The last `limit` runs that actually happened (not skipped) per job, newest first. One LATERAL per job: each is an index range scan. */
export async function recentPerJob(keys: string[], limit = 20): Promise<Map<string, { status: string; durationMs: number | null }[]>> {
  if (keys.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ job: string; status: string; durationMs: number | null }[]>`
    SELECT j."job", r."status", r."durationMs"
    FROM unnest(${keys}::text[]) AS j("job")
    CROSS JOIN LATERAL (
      SELECT "status", "durationMs", "startedAt" FROM "JobRun"
      WHERE "job" = j."job" AND "status" IN ('OK','FAILED','TIMEOUT') ORDER BY "startedAt" DESC LIMIT ${limit}
    ) r
    ORDER BY j."job", r."startedAt" DESC`;
  const out = new Map<string, { status: string; durationMs: number | null }[]>();
  for (const r of rows) (out.get(r.job) ?? out.set(r.job, []).get(r.job)!).push({ status: r.status, durationMs: r.durationMs });
  return out;
}

export async function jobRaw(keys: string[], now: Date): Promise<Map<string, JobRaw>> {
  const [latest, stats, recent] = await Promise.all([latestPerJob(now), statsPerJob(now), recentPerJob(keys)]);
  return new Map(keys.map((k) => [k, { latest: latest.get(k) ?? null, stats: stats.get(k) ?? null, recent: recent.get(k) ?? [] }]));
}

export type TickRow = { id: string; status: string; durationMs: number | null; startedAt: Date; skipReason: string | null; summary: Record<string, number | boolean> | null };

export async function recentTicks(limit = 20): Promise<TickRow[]> {
  const rows = await prisma.jobRun.findMany({ where: { job: "__tick" }, orderBy: { startedAt: "desc" }, take: limit, select: { id: true, status: true, durationMs: true, startedAt: true, skipReason: true, summary: true } });
  return rows.map((r) => ({ ...r, summary: (r.summary as TickRow["summary"]) ?? null }));
}

export async function rejectedWebhooks(now: Date, windowMinutes: number): Promise<Record<string, number>> {
  const rows = await prisma.jobRun.groupBy({ by: ["job"], where: { status: "REJECTED", startedAt: { gt: new Date(now.getTime() - windowMinutes * 60_000) } }, _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.job, r._count._all]));
}

/** Last success, last error and consecutive failures for each feeding job: the evidence behind an integration's state. */
export async function feedStats(jobKeys: string[], now: Date): Promise<Map<string, FeedStats>> {
  const [stats, recent, lastBad] = await Promise.all([
    statsPerJob(now),
    recentPerJob(jobKeys, 10),
    prisma.$queryRaw<{ job: string; startedAt: Date; errorClass: string | null }[]>`
      SELECT DISTINCT ON ("job") "job", "startedAt", "errorClass" FROM "JobRun"
      WHERE "job" = ANY(${jobKeys}::text[]) AND "status" IN ('FAILED','TIMEOUT') AND "startedAt" > ${new Date(now.getTime() - 7 * DAY)}
      ORDER BY "job", "startedAt" DESC`,
  ]);
  const bad = new Map(lastBad.map((b) => [b.job, b]));
  return new Map(jobKeys.map((job) => {
    let consecutive = 0;
    for (const r of recent.get(job) ?? []) { if (r.status === "OK") break; consecutive += 1; }
    const s = stats.get(job);
    return [job, { lastSuccessAt: s?.lastOkAt ?? null, lastErrorAt: bad.get(job)?.startedAt ?? null, lastErrorClass: bad.get(job)?.errorClass ?? null, consecutiveFailures: consecutive, failures24h: s?.bad24 ?? 0 }];
  }));
}

export async function failureGroupRows(now: Date) {
  return prisma.$queryRaw<{ job: string; errorClass: string | null; n: number; firstSeen: Date; lastSeen: Date; latestId: string; latestAttempt: number }[]>`
    SELECT "job", "errorClass", (count(*))::int AS "n", min("startedAt") AS "firstSeen", max("startedAt") AS "lastSeen",
      (array_agg("id" ORDER BY "startedAt" DESC))[1] AS "latestId", (array_agg("attempt" ORDER BY "startedAt" DESC))[1] AS "latestAttempt"
    FROM "JobRun" WHERE "status" IN ('FAILED','TIMEOUT') AND "startedAt" > ${new Date(now.getTime() - 7 * DAY)} AND "job" <> '__tick'
    GROUP BY "job", "errorClass" ORDER BY max("startedAt") DESC LIMIT 60`;
}

export async function openAlerts() {
  return prisma.controlPlaneAlert.findMany({ where: { resolvedAt: null }, orderBy: [{ severity: "asc" }, { firstRaisedAt: "desc" }], take: 50 });
}

/** The jobs that wrote a row in one tick (index on tickId). Anything registered and absent was "not reached". */
export async function jobsOfTick(tickId: string): Promise<string[]> {
  const rows = await prisma.jobRun.findMany({ where: { tickId, job: { not: "__tick" } }, select: { job: true }, take: 100 });
  return rows.map((r) => r.job);
}

/** The last runs of ONE job for its drawer: time, status, duration and counts. Error class only, never a message. */
export async function runsOfJob(job: string, limit = 20) {
  return prisma.jobRun.findMany({ where: { job }, orderBy: { startedAt: "desc" }, take: limit, select: { id: true, kind: true, status: true, startedAt: true, durationMs: true, errorClass: true, skipReason: true, attempt: true, summary: true } });
}

export async function whatsappAccountFacts() {
  const [total, withError] = await Promise.all([prisma.whatsAppAccount.count({ where: { isActive: true } }), prisma.whatsAppAccount.count({ where: { isActive: true, lastError: { not: null } } })]);
  return { total, withError };
}
