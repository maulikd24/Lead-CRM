import { HEARTBEAT_STALE_MS } from "./heartbeat-constants";

/**
 * Alert thresholds: typed defaults that are safe without any configuration, with optional environment overrides
 * (CONTROL_PLANE_ALERT_*). An override outside its bounds, or one that is not a number, is ignored and the default stays, so a typo can
 * never switch an alert off or make it fire constantly. Names and numbers only: nothing here is a secret.
 */
export type AlertConfig = {
  heartbeatStaleMs: number;
  jobFailingConsecutive: number;
  /** A tick job is late after this many times its cadence without a successful or skipped run. Daily jobs use dailyLateMs. */
  jobLateFactor: number;
  dailyLateMs: number;
  tickLeaseMs: number;
  tickOverrunShare: number;
  tickOverrunConsecutive: number;
  outbox: { depth: number; oldestMinutes: number };
  leadIntake: { failed24h: number; unretriedMinutes: number };
  rejectedWebhooks: { count: number; windowMinutes: number };
  persistFailedTicks: number;
  notifyRepeatMs: number;
  /** Jobs whose repeated failure is CRITICAL rather than WARN. */
  criticalJobs: readonly string[];
};

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  heartbeatStaleMs: HEARTBEAT_STALE_MS,
  jobFailingConsecutive: 3,
  jobLateFactor: 2,
  dailyLateMs: 30 * 3_600_000,
  tickLeaseMs: 300_000,
  tickOverrunShare: 0.8,
  tickOverrunConsecutive: 2,
  outbox: { depth: 50, oldestMinutes: 30 },
  leadIntake: { failed24h: 5, unretriedMinutes: 120 },
  rejectedWebhooks: { count: 20, windowMinutes: 10 },
  persistFailedTicks: 3,
  notifyRepeatMs: 24 * 3_600_000,
  criticalJobs: ["runDailyAuditChainCheck", "retryFailedLeads"],
};

function num(env: Record<string, string | undefined>, name: string, fallback: number, min: number, max: number): number {
  const raw = env[`CONTROL_PLANE_ALERT_${name}`];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function loadAlertConfig(env: Record<string, string | undefined> = process.env): AlertConfig {
  const d = DEFAULT_ALERT_CONFIG;
  return {
    ...d,
    heartbeatStaleMs: num(env, "HEARTBEAT_STALE_MINUTES", d.heartbeatStaleMs / 60_000, 1, 240) * 60_000,
    jobFailingConsecutive: num(env, "JOB_FAILING_CONSECUTIVE", d.jobFailingConsecutive, 2, 20),
    outbox: { depth: num(env, "OUTBOX_DEPTH", d.outbox.depth, 1, 10_000), oldestMinutes: num(env, "OUTBOX_OLDEST_MINUTES", d.outbox.oldestMinutes, 1, 1440) },
    leadIntake: { failed24h: num(env, "LEAD_FAILED_24H", d.leadIntake.failed24h, 1, 1000), unretriedMinutes: num(env, "LEAD_UNRETRIED_MINUTES", d.leadIntake.unretriedMinutes, 5, 4320) },
    rejectedWebhooks: { count: num(env, "WEBHOOK_REJECTED_COUNT", d.rejectedWebhooks.count, 1, 10_000), windowMinutes: d.rejectedWebhooks.windowMinutes },
  };
}
