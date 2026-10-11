import { cache } from "react";

import {
  PANEL_BUDGET_MS, feedStats, isMissingTable, jobRaw, jobsOfTick, openAlerts, recentTicks, runsOfJob, safeErrorClass, whatsappAccountFacts, withBudget, type TickRow,
} from "./control-plane-db";
import { buildIntegrationRows, buildJobRows, overallStrip, type IntegrationRow, type JobRow, type Strip } from "./control-plane-model";
import { controlPlaneEnabled } from "./control-plane-flag";
import { groupFailures, type FailureGroup } from "./failures";
import { loadFailureItems } from "./failures-sources";
import { INTEGRATION_FEEDS } from "./integration-map";
import { CRON_JOBS, JOBS, WEBHOOK_JOBS, TICK_KEY } from "./job-registry";
import { collectSystemStatus, type SystemStatus } from "./status";
import { statusDeps } from "./status-wiring";
import { readEventsHealth, type EventsHealth } from "@/lib/data-health/read-db";

/**
 * What each control plane tab shows. Every panel is read independently and bounded (3 second budget, LIMITs, index ranges), so one
 * failing panel shows "Could not read <panel> (<class>)" and the others still render. A panel never carries a driver message.
 */
export type Panel<T> = { ok: true; data: T } | { ok: false; errorClass: string; tablesMissing: boolean };

export async function panel<T>(fn: () => Promise<T>, budgetMs = PANEL_BUDGET_MS): Promise<Panel<T>> {
  try {
    return { ok: true, data: await withBudget(fn(), budgetMs) };
  } catch (error) {
    return { ok: false, errorClass: safeErrorClass(error), tablesMissing: isMissingTable(error) };
  }
}

/** One System status read shared by every panel of a request (also the source of Health's tiles and the integrations' base states). */
export const readStatus = cache(async (): Promise<SystemStatus> => collectSystemStatus(statusDeps, process.env));
const readJobRaw = cache(async () => jobRaw(JOBS.map((j) => j.key), new Date()));

export type AlertRow = { id: string; key: string; severity: string; title: string; detail: Record<string, unknown> | null; firstRaisedAt: Date; lastSeenAt: Date; acknowledgedAt: Date | null };
const SEV: Record<string, number> = { CRITICAL: 0, WARN: 1, INFO: 2 };

export async function readAlerts(): Promise<AlertRow[]> {
  const rows = await openAlerts();
  return rows
    .map((r) => ({ id: r.id, key: r.key, severity: r.severity, title: r.title, detail: (r.detail as Record<string, unknown> | null) ?? null, firstRaisedAt: r.firstRaisedAt, lastSeenAt: r.lastSeenAt, acknowledgedAt: r.acknowledgedAt }))
    .sort((a, b) => (SEV[a.severity] ?? 9) - (SEV[b.severity] ?? 9) || b.firstRaisedAt.getTime() - a.firstRaisedAt.getTime());
}

// ---- the strip above every tab ---------------------------------------------------------------------------------------------------
export type StripData = { strip: Strip; alerts: AlertRow[]; generatedAt: Date; alertsPanel: Panel<true> };

export async function readStrip(now = new Date()): Promise<StripData> {
  const [alerts, status, raw] = await Promise.all([panel(readAlerts), panel(readStatus), panel(readJobRaw)]);
  const openList = alerts.ok ? alerts.data : [];
  const failingJobs = raw.ok ? [...raw.data.values()].filter((r) => r.latest && (r.latest.status === "FAILED" || r.latest.status === "TIMEOUT")).length : 0;
  const strip = overallStrip({ openAlerts: openList, attention: status.ok ? status.data.attention.length : 0, failingJobs, badIntegrations: 0 });
  return { strip, alerts: openList, generatedAt: now, alertsPanel: alerts.ok ? { ok: true, data: true } : alerts };
}

// ---- Health --------------------------------------------------------------------------------------------------------------------------
export type HealthData = {
  status: SystemStatus;
  tick: { heartbeatMinutes: number | null; heartbeatState: SystemStatus["cron"]["tick"]["state"]; last: TickRow | null; skippedInARow: number; windowShare: number | null; abandoned: number };
  jobsLastTick: { ok: number; failed: number; skipped: number; notReached: number; ranAt: Date | null } | null;
  whatsapp: { accounts: number; withError: number; lastInboundAt: Date | null };
  freshness: { name: string; at: Date | null }[];
  audit: { lastStatus: string | null; lastAt: Date | null };
  release: { sha: string; branch: string | null; env: string };
  alerts: AlertRow[];
};

export async function readHealth(now = new Date()): Promise<{ tablesMissing: boolean; status: Panel<SystemStatus>; tick: Panel<HealthData["tick"]>; jobsLastTick: Panel<HealthData["jobsLastTick"]>; whatsapp: Panel<HealthData["whatsapp"]>; freshness: Panel<HealthData["freshness"]>; audit: Panel<HealthData["audit"]>; alerts: Panel<AlertRow[]>; release: HealthData["release"]; events?: Panel<EventsHealth> }> {
  const status = await panel(readStatus);
  const tick = await panel(async () => {
    const ticks = await recentTicks(10);
    const finished = ticks.find((t) => t.status === "OK" || t.status === "FAILED") ?? null;
    let skippedInARow = 0;
    for (const t of ticks) { if (t.status === "SKIPPED") skippedInARow += 1; else break; }
    const st = status.ok ? status.data.cron.tick : { state: "unknown" as const, minutesAgo: null };
    return { heartbeatMinutes: st.minutesAgo, heartbeatState: st.state, last: finished, skippedInARow, windowShare: finished?.durationMs != null ? finished.durationMs / 300_000 : null, abandoned: ticks.filter((t) => t.status === "ABANDONED").length };
  });
  const jobsLastTick = await panel(async () => {
    const ticks = await recentTicks(5);
    const last = ticks.find((t) => t.status === "OK" || t.status === "FAILED");
    if (!last) return null;
    const seen = new Set(await jobsOfTick(last.id));
    const s = last.summary ?? {};
    return { ok: Number(s.ok ?? 0), failed: Number(s.failed ?? 0) + Number(s.timeout ?? 0), skipped: Number(s.skipped ?? 0), notReached: CRON_JOBS.filter((j) => j.key !== "heartbeat" && !seen.has(j.key)).length, ranAt: last.startedAt };
  });
  const whatsapp = await panel(async () => {
    const [facts, raw] = await Promise.all([whatsappAccountFacts(), readJobRaw()]);
    return { accounts: facts.total, withError: facts.withError, lastInboundAt: raw.get("webhook:whatsapp-events")?.stats?.lastOkAt ?? null };
  });
  const freshness = await panel(async () => {
    const raw = await readJobRaw();
    const cronJobs = status.ok ? status.data.cron.jobs : [];
    const at = (name: string) => { const j = cronJobs.find((x) => x.name === name); return j ? new Date(j.lastRunAt) : null; };
    return [
      { name: "Meta ad sync", at: at("ad_sync:meta") }, { name: "Google ad sync", at: at("ad_sync:google") },
      { name: "Back-office import", at: at("backoffice_import") }, { name: "Portfolio feed", at: raw.get("webhook:portfolio-ingest")?.stats?.lastOkAt ?? null },
    ];
  });
  const audit = await panel(async () => {
    const raw = await readJobRaw();
    const l = raw.get("runDailyAuditChainCheck")?.latest;
    return { lastStatus: l?.status ?? null, lastAt: l?.startedAt ?? null };
  });
  const alerts = await panel(readAlerts);
  // Wave 1 hook: one tile for the customer event bus (consumer lag, dead letters, failed emits). Additive: the other panels never wait on it.
  const events = await panel(() => readEventsHealth(now));
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  void now;
  return {
    tablesMissing: [tick, jobsLastTick, alerts].some((p) => !p.ok && p.tablesMissing),
    status, tick, jobsLastTick, whatsapp, freshness, audit, alerts, events,
    release: { sha: sha && sha.length >= 7 ? sha.slice(0, 7) : "unknown", branch: process.env.VERCEL_GIT_COMMIT_REF ?? null, env: process.env.VERCEL_ENV ?? "local" },
  };
}

// ---- Jobs ----------------------------------------------------------------------------------------------------------------------------
export type JobsData = { cron: JobRow[]; webhooks: JobRow[]; tablesSeen: boolean };

export async function readJobs(now = new Date()): Promise<JobsData> {
  const raw = await readJobRaw();
  const env = process.env;
  const cron = buildJobRows(CRON_JOBS, raw, env, now);
  const webhooks = buildJobRows(WEBHOOK_JOBS, raw, env, now);
  return { cron, webhooks, tablesSeen: [...raw.values()].some((r) => r.latest) };
}

export async function readJobDrawer(job: string) {
  if (!JOBS.some((j) => j.key === job)) return [];
  return runsOfJob(job, 20);
}

// ---- Failures ------------------------------------------------------------------------------------------------------------------------
export async function readFailures(now = new Date()): Promise<FailureGroup[]> {
  return groupFailures(await loadFailureItems(now));
}

// ---- Integrations --------------------------------------------------------------------------------------------------------------------
export async function readIntegrations(now = new Date()): Promise<IntegrationRow[]> {
  const status = await readStatus();
  const feedJobs = [...new Set(Object.values(INTEGRATION_FEEDS).flatMap((f) => f.jobs))];
  const stats = await feedStats(feedJobs, now);
  return buildIntegrationRows(status.integrations, stats, now);
}

export { controlPlaneEnabled, TICK_KEY };
