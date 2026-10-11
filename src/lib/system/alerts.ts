import type { AlertConfig } from "./alert-config";
import { expectedIntervalMs, type JobSpec } from "./job-registry";

/**
 * The alert rules, pure: facts in, desired alerts out; then reconcile against what is already open. No database, no clock of its own,
 * no network. An alert's title and detail hold keys, counts and thresholds only, never a customer value (a test pins that).
 * Delivery lives in alerts-db.ts: in-app Notification rows for ADMINs and a page-side email DRAFT. Nothing here sends anything.
 *
 * Rules not built in this slice (their sources arrive later, through the same evaluateRules): flags-invalid (needs the flag registry),
 * db-slow, job-not-reached, audit-chain-broken (already notifies Admins through its own job), agent cost, consent coverage, dead letters.
 */
export type Severity = "INFO" | "WARN" | "CRITICAL";
export type DesiredAlert = { key: string; severity: Severity; title: string; detail: Record<string, number | string | boolean> };
export type OpenAlert = { id: string; key: string; severity: string; notifiedAt: Date | null; acknowledgedAt: Date | null };

export type IntegrationStateName = "FLAG_OFF" | "NOT_CONFIGURED" | "MOCK" | "DISABLED" | "DOWN" | "DEGRADED" | "UNTESTED" | "HEALTHY";

export type AlertFacts = {
  now: Date;
  heartbeatAgeMs: number | null;
  /** Per cron job: statuses of runs that actually happened (not skipped), newest first; and when it was last alive (OK or SKIPPED). */
  jobs: { spec: JobSpec; recent: string[]; lastAliveAt: Date | null; flagOn: boolean }[];
  /** Latest finished ticks, newest first. */
  ticks: { durationMs: number; status: string }[];
  whatsappOutbox: { depth: number; oldestMinutes: number | null };
  leadIntake: { failed24h: number; oldestUnretriedMinutes: number | null };
  integrations: { key: string; label: string; state: IntegrationStateName }[];
  /** REJECTED webhook runs inside the window, per webhook job key. */
  rejectedWebhooks: Record<string, number>;
  persistFailedTicks: number;
  abandonedTicks: number;
};

const minutes = (ms: number) => Math.round(ms / 60_000);

function lateAfterMs(spec: JobSpec, cfg: AlertConfig): number {
  if ("every" in spec.cadence && spec.cadence.every === "day") return cfg.dailyLateMs;
  return expectedIntervalMs(spec.cadence) * cfg.jobLateFactor;
}

export function evaluateRules(f: AlertFacts, cfg: AlertConfig): DesiredAlert[] {
  const out: DesiredAlert[] = [];
  const heartbeatStale = f.heartbeatAgeMs === null || f.heartbeatAgeMs > cfg.heartbeatStaleMs;

  if (heartbeatStale) {
    out.push({
      key: "heartbeat-stale", severity: "CRITICAL",
      title: f.heartbeatAgeMs === null ? "The scheduler has never ticked" : `The scheduler has not ticked for ${minutes(f.heartbeatAgeMs)} minutes`,
      detail: { ageMinutes: f.heartbeatAgeMs === null ? -1 : minutes(f.heartbeatAgeMs), thresholdMinutes: minutes(cfg.heartbeatStaleMs) },
    });
  }

  if (f.abandonedTicks > 0) {
    out.push({ key: "tick-overrun", severity: "CRITICAL", title: "A scheduler tick was killed before it finished", detail: { abandoned: f.abandonedTicks } });
  } else {
    const limit = cfg.tickLeaseMs * cfg.tickOverrunShare;
    const lead = f.ticks.slice(0, cfg.tickOverrunConsecutive);
    if (lead.length === cfg.tickOverrunConsecutive && lead.every((t) => t.durationMs > limit)) {
      out.push({ key: "tick-overrun", severity: "WARN", title: `Scheduler ticks are using over ${Math.round(cfg.tickOverrunShare * 100)}% of their time window`, detail: { lastTickSeconds: Math.round(lead[0].durationMs / 1000), windowSeconds: cfg.tickLeaseMs / 1000 } });
    }
  }

  for (const j of f.jobs) {
    let consecutive = 0;
    for (const s of j.recent) { if (s === "FAILED" || s === "TIMEOUT") consecutive += 1; else break; }
    if (consecutive >= cfg.jobFailingConsecutive) {
      out.push({ key: `job-failing:${j.spec.key}`, severity: cfg.criticalJobs.includes(j.spec.key) ? "CRITICAL" : "WARN", title: `${j.spec.label} has failed ${consecutive} runs in a row`, detail: { job: j.spec.key, consecutive, threshold: cfg.jobFailingConsecutive } });
    }
    const cadence = expectedIntervalMs(j.spec.cadence);
    if (!heartbeatStale && j.flagOn && cadence > 0 && j.lastAliveAt) {
      const age = f.now.getTime() - j.lastAliveAt.getTime();
      if (age > lateAfterMs(j.spec, cfg)) out.push({ key: `job-late:${j.spec.key}`, severity: "WARN", title: `${j.spec.label} has not run for ${minutes(age) >= 120 ? `${Math.round(minutes(age) / 60)} hours` : `${minutes(age)} minutes`}`, detail: { job: j.spec.key, ageMinutes: minutes(age), expectedEveryMinutes: minutes(cadence) } });
    }
  }

  const o = f.whatsappOutbox;
  if (o.depth > cfg.outbox.depth || (o.depth > 0 && o.oldestMinutes !== null && o.oldestMinutes > cfg.outbox.oldestMinutes)) {
    out.push({ key: "outbox-depth", severity: "WARN", title: `${o.depth} WhatsApp messages are waiting to send${o.oldestMinutes !== null ? `, the oldest for ${o.oldestMinutes} minutes` : ""}`, detail: { depth: o.depth, oldestMinutes: o.oldestMinutes ?? -1, depthThreshold: cfg.outbox.depth, oldestThresholdMinutes: cfg.outbox.oldestMinutes } });
  }

  const l = f.leadIntake;
  if (l.failed24h > cfg.leadIntake.failed24h || (l.failed24h > 0 && l.oldestUnretriedMinutes !== null && l.oldestUnretriedMinutes > cfg.leadIntake.unretriedMinutes)) {
    out.push({ key: "lead-intake-failed", severity: "WARN", title: `${l.failed24h} lead${l.failed24h === 1 ? "" : "s"} failed to be recorded in the last 24 hours`, detail: { failed24h: l.failed24h, oldestMinutes: l.oldestUnretriedMinutes ?? -1, threshold: cfg.leadIntake.failed24h } });
  }

  for (const i of f.integrations) {
    if (i.state === "DOWN") out.push({ key: `integration-down:${i.key}`, severity: "CRITICAL", title: `${i.label} is down`, detail: { integration: i.key } });
    else if (i.state === "DEGRADED") out.push({ key: `integration-degraded:${i.key}`, severity: "WARN", title: `${i.label} is having problems`, detail: { integration: i.key } });
  }

  for (const [job, count] of Object.entries(f.rejectedWebhooks)) {
    if (count > cfg.rejectedWebhooks.count) out.push({ key: `webhook-rejected-spike:${job}`, severity: "WARN", title: `${count} rejected calls to ${job.replace(/^webhook:/, "")} in ${cfg.rejectedWebhooks.windowMinutes} minutes`, detail: { job, count, windowMinutes: cfg.rejectedWebhooks.windowMinutes } });
  }

  if (f.persistFailedTicks >= cfg.persistFailedTicks) {
    out.push({ key: "jobrun-persist-failing", severity: "WARN", title: "Job runs could not be recorded for several ticks in a row", detail: { ticks: f.persistFailedTicks } });
  }
  return out;
}

export type Reconciliation = {
  raise: DesiredAlert[];
  /** ids of open alerts whose condition still holds */
  touch: string[];
  resolve: string[];
  escalate: DesiredAlert[];
  /** alerts that should create in-app notifications now */
  notify: DesiredAlert[];
};

const RANK: Record<string, number> = { INFO: 0, WARN: 1, CRITICAL: 2 };

/** One open row per key. Notifies on raise and on escalation, then at most once per notifyRepeatMs while open and not acknowledged. */
export function reconcileAlerts(open: OpenAlert[], desired: DesiredAlert[], now: Date, repeatMs = 24 * 3_600_000): Reconciliation {
  const byKey = new Map(open.map((o) => [o.key, o]));
  const wanted = new Set(desired.map((d) => d.key));
  const r: Reconciliation = { raise: [], touch: [], resolve: open.filter((o) => !wanted.has(o.key)).map((o) => o.id), escalate: [], notify: [] };
  for (const d of desired) {
    const existing = byKey.get(d.key);
    if (!existing) { r.raise.push(d); r.notify.push(d); continue; }
    r.touch.push(existing.id);
    if ((RANK[d.severity] ?? 0) > (RANK[existing.severity] ?? 0)) { r.escalate.push(d); r.notify.push(d); continue; }
    if (existing.acknowledgedAt) continue;
    if (!existing.notifiedAt || now.getTime() - existing.notifiedAt.getTime() >= repeatMs) r.notify.push(d);
  }
  return r;
}

export type EmailDraft = { to: string; subject: string; body: string; mailto: string };

/** A prefilled draft for the Admin to copy or open in their own mail program. Addressed to nobody; the system never sends it. */
export function buildAlertEmailDraft(alert: { key: string; severity: string; title: string; detail: Record<string, unknown> | null; firstRaisedAt: Date }, pageUrl: string): EmailDraft {
  const subject = `[${alert.severity}] ${alert.title}`;
  const facts = Object.entries(alert.detail ?? {}).map(([k, v]) => `- ${k}: ${String(v)}`).join("\n");
  const body = `${alert.title}\n\nFirst seen: ${alert.firstRaisedAt.toISOString()}\nAlert: ${alert.key}\n${facts ? `\n${facts}\n` : ""}\nOpen the control plane: ${pageUrl}\n\nThis is a draft. Nothing has been sent.`;
  return { to: "", subject, body, mailto: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` };
}
