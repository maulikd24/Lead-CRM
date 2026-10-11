import { DEFAULT_ALERT_CONFIG } from "./alert-config";
import { lateAfterMs } from "./alerts";
import { INTEGRATION_FEEDS } from "./integration-map";
import { classifyIssue, computeIntegrationState, type FeedStats, type IntegrationVerdict } from "./integration-status";
import { describeCadence, expectedIntervalMs, jobSpec, type JobSpec } from "./job-registry";

/** Pure assembly of what the control plane tabs show. No database, no clock of its own. */
export type Tone = "ok" | "warn" | "bad" | "idle";

export type LatestRun = { status: string; startedAt: Date; durationMs: number | null; errorClass: string | null; skipReason: string | null; attempt: number };
export type JobStats = { ok24: number; bad24: number; ok7: number; bad7: number; lastOkAt: Date | null; lastAliveAt: Date | null };
/** `recent`: newest first, runs that actually happened (not skipped). */
export type JobRaw = { latest: LatestRun | null; stats: JobStats | null; recent: { status: string; durationMs: number | null }[] };

export type JobState = "failing" | "late" | "flag-off" | "skipped" | "not-seen" | "ok";

export type JobRow = {
  key: string; label: string; owner: string; cadence: string; kind: "CRON" | "WEBHOOK";
  state: JobState; lastRunAt: Date | null; lastStatus: string | null; lastDurationMs: number | null;
  rate24h: number | null; rate7d: number | null; consecutiveFailures: number; lastErrorClass: string | null;
  lastSuccessAt: Date | null; nextDueAt: Date | null; budgetShare: number | null; durations: number[]; trend: "faster" | "steady" | "slower";
  safeToRun: boolean; skipReason: string | null;
};

export const successRate = (ok: number, bad: number): number | null => (ok + bad === 0 ? null : ok / (ok + bad));

export function nextDueAt(spec: JobSpec, lastAliveAt: Date | null, now: Date): Date | null {
  const interval = expectedIntervalMs(spec.cadence);
  if (interval === 0) return null;
  return lastAliveAt ? new Date(lastAliveAt.getTime() + interval) : now;
}

/** "slower" when the recent half of the durations averages 25% or more above the earlier half, "faster" for 25% below. Needs 4 points. */
export function trendOf(durations: number[]): "faster" | "steady" | "slower" {
  if (durations.length < 4) return "steady";
  const half = Math.floor(durations.length / 2);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const early = avg(durations.slice(0, half));
  const late = avg(durations.slice(half));
  if (early === 0) return "steady";
  return late >= early * 1.25 ? "slower" : late <= early * 0.75 ? "faster" : "steady";
}

const BAD = new Set(["FAILED", "TIMEOUT"]);
const TICK_WINDOW_MS = 300_000;

export function buildJobRows(specs: readonly JobSpec[], data: Map<string, JobRaw>, env: Record<string, string | undefined>, now: Date): JobRow[] {
  const rows = specs.map((spec): JobRow => {
    const d = data.get(spec.key) ?? { latest: null, stats: null, recent: [] };
    const latest = d.latest;
    let consecutive = 0;
    for (const r of d.recent) {
      if (BAD.has(r.status)) consecutive += 1;
      else break;
    }
    const lastAliveAt = d.stats?.lastAliveAt ?? latest?.startedAt ?? null;
    let state: JobState;
    if (latest?.status === "SKIPPED" && latest.skipReason === "flag off") state = "flag-off";
    else if (latest && BAD.has(latest.status)) state = "failing";
    else if (!latest) state = spec.flag && env[spec.flag] !== "1" ? "flag-off" : "not-seen";
    else if (spec.kind === "CRON" && lastAliveAt && now.getTime() - lastAliveAt.getTime() > lateAfterMs(spec, DEFAULT_ALERT_CONFIG)) state = "late";
    else if (latest.status === "SKIPPED") state = "skipped";
    else state = "ok";
    const durations = d.recent.map((r) => r.durationMs ?? 0).reverse();
    return {
      key: spec.key, label: spec.label, owner: spec.owner, cadence: describeCadence(spec.cadence), kind: spec.kind, state,
      lastRunAt: latest?.startedAt ?? null, lastStatus: latest?.status ?? null, lastDurationMs: latest?.durationMs ?? null,
      rate24h: d.stats ? successRate(d.stats.ok24, d.stats.bad24) : null, rate7d: d.stats ? successRate(d.stats.ok7, d.stats.bad7) : null,
      consecutiveFailures: consecutive, lastErrorClass: latest && BAD.has(latest.status) ? latest.errorClass : null,
      lastSuccessAt: d.stats?.lastOkAt ?? null, nextDueAt: spec.kind === "CRON" ? nextDueAt(spec, lastAliveAt, now) : null,
      budgetShare: spec.kind === "CRON" && latest?.durationMs != null ? latest.durationMs / TICK_WINDOW_MS : null,
      durations, trend: trendOf(durations), safeToRun: spec.safeToRun, skipReason: latest?.skipReason ?? null,
    };
  });
  const rank: Record<JobState, number> = { failing: 0, late: 1, "not-seen": 2, ok: 3, skipped: 4, "flag-off": 5 };
  return rows.sort((a, b) => rank[a.state] - rank[b.state] || (b.lastDurationMs ?? 0) - (a.lastDurationMs ?? 0));
}

export type StatusIntegration = { key: string; label: string; state: "connected" | "needs_setup" | "mock" | "flag_off"; note: string };
export type IntegrationRow = {
  key: string; label: string; state: IntegrationVerdict["state"]; reason: string; issue: IntegrationVerdict["issue"];
  lastSuccessAt: Date | null; lastErrorAt: Date | null; lastErrorClass: string | null; settingsHref: string; note: string | null; feeds: { job: string; label: string }[];
};

const maxDate = (xs: (Date | null)[]) => xs.reduce<Date | null>((m, x) => (x && (!m || x > m) ? x : m), null);

const aggregateFeeds = (jobs: string[], stats: Map<string, FeedStats>): FeedStats | null => {
  const parts = jobs.map((j) => stats.get(j)).filter((s): s is FeedStats => !!s);
  if (parts.length === 0) return null;
  const lastErrorAt = maxDate(parts.map((p) => p.lastErrorAt));
  return {
    lastSuccessAt: maxDate(parts.map((p) => p.lastSuccessAt)), lastErrorAt,
    lastErrorClass: parts.find((p) => p.lastErrorAt && lastErrorAt && p.lastErrorAt.getTime() === lastErrorAt.getTime())?.lastErrorClass ?? null,
    consecutiveFailures: Math.max(...parts.map((p) => p.consecutiveFailures)), failures24h: parts.reduce((n, p) => n + p.failures24h, 0),
  };
};

export function buildIntegrationRows(base: StatusIntegration[], stats: Map<string, FeedStats>, now: Date): IntegrationRow[] {
  return base.map((b) => {
    const feed = INTEGRATION_FEEDS[b.key] ?? { jobs: [], settingsHref: "/settings/system" };
    const agg = aggregateFeeds(feed.jobs, stats);
    const verdict = computeIntegrationState({ base: b.state, note: b.note, stats: agg, intervalMs: feed.everyHours ? feed.everyHours * 3_600_000 : null, hasFeeds: feed.jobs.length > 0, now });
    return {
      key: b.key, label: b.label, state: verdict.state, reason: verdict.reason, issue: verdict.issue ?? classifyIssue(agg?.lastErrorClass ?? null),
      lastSuccessAt: agg?.lastSuccessAt ?? null, lastErrorAt: agg?.lastErrorAt ?? null, lastErrorClass: agg?.lastErrorClass ?? null,
      settingsHref: feed.settingsHref, note: feed.note ?? null, feeds: feed.jobs.map((j) => ({ job: j, label: jobSpec(j)?.label ?? j })),
    };
  });
}

export type Strip = { tone: Tone; word: string; needsAttention: number };

export function overallStrip(i: { openAlerts: { severity: string }[]; attention: number; failingJobs: number; badIntegrations: number }): Strip {
  const needsAttention = i.attention + i.failingJobs + i.badIntegrations + i.openAlerts.length;
  if (i.openAlerts.some((a) => a.severity === "CRITICAL")) return { tone: "bad", word: "Critical", needsAttention };
  if (needsAttention > 0) return { tone: "warn", word: "Needs attention", needsAttention };
  return { tone: "ok", word: "All clear", needsAttention: 0 };
}
