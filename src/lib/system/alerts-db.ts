import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { MAX_LEAD_ATTEMPTS } from "@/lib/leads/retry";

import { loadAlertConfig } from "./alert-config";
import { evaluateRules, reconcileAlerts, type AlertFacts, type DesiredAlert } from "./alerts";
import { feedStats, jobRaw, recentTicks, rejectedWebhooks } from "./control-plane-db";
import { buildIntegrationRows } from "./control-plane-model";
import { INTEGRATION_FEEDS } from "./integration-map";
import { CRON_HEARTBEAT } from "./heartbeat-constants";
import { getHeartbeatAgeMs } from "./heartbeat";
import { CRON_JOBS } from "./job-registry";
import { abandonStaleTicks } from "./job-run-db";
import { collectSystemStatus } from "./status";
import { statusDeps } from "./status-wiring";

const DAY = 86_400_000;
const LEASE_MS = 300_000;
export const ALERT_NOTIFICATION_TYPE = "control_plane_alert";

/** Reads only the facts the rules need. Cheap: a handful of bounded queries, the same ones the screens use. */
export async function gatherAlertFacts(now: Date, env: Record<string, string | undefined> = process.env): Promise<AlertFacts> {
  const cfg = loadAlertConfig(env);
  const keys = CRON_JOBS.map((j) => j.key);
  const feedKeys = [...new Set(Object.values(INTEGRATION_FEEDS).flatMap((f) => f.jobs))];
  const [heartbeatAgeMs, raw, ticks, rejected, status, stats, leadFailed24h, leadPending, abandoned] = await Promise.all([
    getHeartbeatAgeMs(CRON_HEARTBEAT, now),
    jobRaw(keys, now),
    recentTicks(8),
    rejectedWebhooks(now, cfg.rejectedWebhooks.windowMinutes),
    collectSystemStatus(statusDeps, env, now),
    feedStats(feedKeys, now),
    prisma.leadIntake.count({ where: { status: "ERROR", receivedAt: { gte: new Date(now.getTime() - DAY) } } }),
    prisma.leadIntake.findFirst({ where: { status: "ERROR", attempts: { lt: MAX_LEAD_ATTEMPTS } }, orderBy: { receivedAt: "asc" }, select: { receivedAt: true } }),
    prisma.jobRun.count({ where: { job: "__tick", status: "ABANDONED", startedAt: { gt: new Date(now.getTime() - DAY) } } }),
  ]);
  const outbox = status.queues.find((q) => q.key === "whatsapp_outbox");
  const integrations = buildIntegrationRows(status.integrations, stats, now).map((r) => ({ key: r.key, label: r.label, state: r.state }));
  let persistFailedTicks = 0;
  for (const t of ticks) { if (t.summary?.persistFailed === true) persistFailedTicks += 1; else if (t.status !== "RUNNING") break; }
  return {
    now, heartbeatAgeMs,
    jobs: CRON_JOBS.map((spec) => {
      const d = raw.get(spec.key)!;
      return { spec, recent: d.recent.map((r) => r.status), lastAliveAt: d.stats?.lastAliveAt ?? d.latest?.startedAt ?? null, flagOn: !spec.flag || env[spec.flag] === "1" };
    }),
    ticks: ticks.filter((t) => t.status === "OK" && t.durationMs !== null).map((t) => ({ durationMs: t.durationMs!, status: t.status })),
    whatsappOutbox: { depth: outbox?.depth ?? 0, oldestMinutes: outbox?.oldestMinutes ?? null },
    leadIntake: { failed24h: leadFailed24h, oldestUnretriedMinutes: leadPending ? Math.round((now.getTime() - leadPending.receivedAt.getTime()) / 60_000) : null },
    integrations, rejectedWebhooks: rejected, persistFailedTicks, abandonedTicks: abandoned,
  };
}

/**
 * Cron job "evaluateAlerts" (and the page, idempotently): evaluate the rules, keep one open row per key, resolve the ones that cleared
 * and create in-app Notification rows for ADMINs (once on raise, then at most once per 24 h while open and unacknowledged).
 * It never sends an email, a message or a push: an email DRAFT is only offered on the page.
 */
export async function runAlertEvaluation(now = new Date(), env: Record<string, string | undefined> = process.env) {
  const cfg = loadAlertConfig(env);
  const abandoned = await abandonStaleTicks(now, LEASE_MS);
  const desired = evaluateRules(await gatherAlertFacts(now, env), cfg);
  const open = await prisma.controlPlaneAlert.findMany({ where: { resolvedAt: null }, select: { id: true, key: true, severity: true, notifiedAt: true, acknowledgedAt: true } });
  const plan = reconcileAlerts(open, desired, now, cfg.notifyRepeatMs);
  const byKey = new Map(desired.map((d) => [d.key, d]));
  const json = (d: DesiredAlert) => d.detail as Prisma.InputJsonValue;

  for (const d of plan.raise) {
    await prisma.controlPlaneAlert.create({ data: { key: d.key, severity: d.severity, title: d.title, detail: json(d), firstRaisedAt: now, lastSeenAt: now } });
  }
  const openByKey = new Map(open.map((o) => [o.key, o]));
  for (const id of plan.touch) {
    const o = open.find((x) => x.id === id)!;
    const d = byKey.get(o.key)!;
    await prisma.controlPlaneAlert.update({ where: { id }, data: { lastSeenAt: now, title: d.title, detail: json(d), severity: d.severity } });
  }
  if (plan.resolve.length) await prisma.controlPlaneAlert.updateMany({ where: { id: { in: plan.resolve } }, data: { resolvedAt: now } });

  let notified = 0;
  if (plan.notify.length) {
    const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
    for (const d of plan.notify) {
      await prisma.notification.createMany({ data: admins.map((a) => ({ userId: a.id, type: ALERT_NOTIFICATION_TYPE, payload: { key: d.key, severity: d.severity, title: d.title, detail: d.detail } as Prisma.InputJsonValue })) });
      await prisma.controlPlaneAlert.updateMany({ where: { key: d.key, resolvedAt: null }, data: { notifiedAt: now } });
      notified += admins.length;
    }
  }
  void openByKey;
  return { raised: plan.raise.length, resolved: plan.resolve.length, open: desired.length, notified, abandonedTicks: abandoned };
}

/** Acknowledge: suppresses re-notification, keeps the alert in the strip. Plain ids, no foreign key. */
export async function acknowledgeAlert(id: string, userId: string, now = new Date()): Promise<boolean> {
  const r = await prisma.controlPlaneAlert.updateMany({ where: { id, resolvedAt: null, acknowledgedAt: null }, data: { acknowledgedAt: now, acknowledgedById: userId } });
  return r.count > 0;
}
