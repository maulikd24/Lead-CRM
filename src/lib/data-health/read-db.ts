import { basePrisma as db } from "@/lib/db/prisma";
import { readConsumerLag } from "@/lib/events/consumers-db";
import { customerEventsEnabled } from "@/lib/events/flag";

import { CHECKS, type CheckKey, type Severity } from "./model";

/** Read side of the Data health tab and the Health tab's event tile. Read only, bounded, ADMIN only (the control plane route enforces it). */
const ITEM_LIMIT = 60;

export type DataHealthItemView = {
  id: string; checkKey: CheckKey; title: string; severity: Severity; status: string; subjectType: string; subjectId: string;
  clientId: string | null; clientCode: string | null; detail: Record<string, string | number | boolean | null>; firstSeenAt: Date; lastSeenAt: Date;
};
export type DataHealthData = {
  enabled: boolean;
  lastRunAt: Date | null;
  summary: { high: number; warn: number; info: number; acknowledged: number };
  checks: { key: CheckKey; title: string; severity: Severity; why: string; fix: string; open: number; acknowledged: number }[];
  items: DataHealthItemView[];
  deadLetters: { id: string; consumer: string; eventType: string; attempts: number; errorClass: string | null; lastFailedAt: Date }[];
  consumers: { consumer: string; pending: number; lagSeconds: number; lastRunAt: Date | null; lastError: string | null; processedTotal: number }[];
  emitFailuresOpen: number;
};

export async function readDataHealth(now = new Date()): Promise<DataHealthData> {
  // The list the tab shows is the worst first: open High, then Warning, then Info (each its own bounded query, so a flood of Warnings cannot push a High off the list), then acknowledged.
  const open = (severity: string, take: number) => db.dataHealthItem.findMany({ where: { status: "OPEN", severity }, orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }], take });
  const [grouped, high, warn, info, acked, dead, consumers, emitOpen, marker] = await Promise.all([
    db.dataHealthItem.groupBy({ by: ["checkKey", "status", "severity"], where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } }, _count: { _all: true } }),
    open("HIGH", ITEM_LIMIT), open("WARN", ITEM_LIMIT), open("INFO", 20),
    db.dataHealthItem.findMany({ where: { status: "ACKNOWLEDGED" }, orderBy: { lastSeenAt: "desc" }, take: 20 }),
    db.eventDeadLetter.findMany({ where: { status: "DEAD" }, orderBy: { lastFailedAt: "desc" }, take: 20, select: { id: true, consumer: true, attempts: true, errorClass: true, lastFailedAt: true, event: { select: { eventType: true } } } }),
    readConsumerLag(now),
    db.eventEmitFailure.count({ where: { status: "OPEN" } }),
    db.eventCursor.findUnique({ where: { consumer: "job:data-health" }, select: { lastRunAt: true } }),
  ]);

  const summary = { high: 0, warn: 0, info: 0, acknowledged: 0 };
  const perCheck = new Map<string, { open: number; acknowledged: number }>();
  for (const g of grouped) {
    const n = g._count._all;
    const c = perCheck.get(g.checkKey) ?? { open: 0, acknowledged: 0 };
    if (g.status === "ACKNOWLEDGED") { c.acknowledged += n; summary.acknowledged += n; } else {
      c.open += n;
      if (g.severity === "HIGH") summary.high += n; else if (g.severity === "WARN") summary.warn += n; else summary.info += n;
    }
    perCheck.set(g.checkKey, c);
  }

  const items = [...high, ...warn, ...info, ...acked].filter((i) => i.checkKey in CHECKS).slice(0, ITEM_LIMIT);
  const clientIds = [...new Set(items.map((i) => i.clientId).filter((x): x is string => !!x))];
  const codes = clientIds.length ? new Map((await db.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, clientCode: true } })).map((c) => [c.id, c.clientCode])) : new Map<string, string>();

  return {
    enabled: customerEventsEnabled(),
    lastRunAt: marker?.lastRunAt ?? null,
    summary,
    checks: (Object.keys(CHECKS) as CheckKey[]).map((key) => ({ key, title: CHECKS[key].title, severity: CHECKS[key].severity, why: CHECKS[key].why, fix: CHECKS[key].fix, open: perCheck.get(key)?.open ?? 0, acknowledged: perCheck.get(key)?.acknowledged ?? 0 })),
    items: items.map((i) => ({
      id: i.id, checkKey: i.checkKey as CheckKey, title: i.title, severity: i.severity as Severity, status: i.status, subjectType: i.subjectType, subjectId: i.subjectId,
      clientId: i.clientId, clientCode: i.clientId ? codes.get(i.clientId) ?? null : null, detail: (i.detail ?? {}) as DataHealthItemView["detail"], firstSeenAt: i.firstSeenAt, lastSeenAt: i.lastSeenAt,
    })),
    deadLetters: dead.map((d) => ({ id: d.id, consumer: d.consumer, eventType: d.event.eventType, attempts: d.attempts, errorClass: d.errorClass, lastFailedAt: d.lastFailedAt })),
    consumers,
    emitFailuresOpen: emitOpen,
  };
}

export type EventsHealth = { enabled: boolean; pending: number; lagSeconds: number; deadLetters: number; emitFailuresOpen: number; consumers: number; lastRunAt: Date | null };

/** The small hook for the Health tab: one tile with consumer lag, dead letters and failed emits. */
export async function readEventsHealth(now = new Date()): Promise<EventsHealth> {
  const [consumers, dead, emitOpen] = await Promise.all([readConsumerLag(now), db.eventDeadLetter.count({ where: { status: "DEAD" } }), db.eventEmitFailure.count({ where: { status: "OPEN" } })]);
  return {
    enabled: customerEventsEnabled(),
    pending: Math.max(0, ...consumers.map((c) => c.pending)),
    lagSeconds: Math.max(0, ...consumers.map((c) => c.lagSeconds)),
    deadLetters: dead,
    emitFailuresOpen: emitOpen,
    consumers: consumers.length,
    lastRunAt: consumers.reduce<Date | null>((m, c) => (c.lastRunAt && (!m || c.lastRunAt > m) ? c.lastRunAt : m), null),
  };
}
