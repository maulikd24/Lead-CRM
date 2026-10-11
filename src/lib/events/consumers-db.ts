import { basePrisma } from "@/lib/db/prisma";

import { dataHealthConsumer } from "@/lib/data-health/consumer";

import { auditConsumer } from "./audit-consumer";
import { lagOf, retryDeadLetter, runConsumer, type ConsumerStore, type EventConsumer, type RunOptions, type RunSummary } from "./consumers";
import type { StoredEvent } from "./envelope";
import { customerEventsEnabled } from "./flag";

/** Postgres store for the consumers. Uses the un-extended client: consumer bookkeeping is system work, never a user's action. */
export const consumerStore: ConsumerStore = {
  async getCursor(name) {
    const c = await basePrisma.eventCursor.findUnique({ where: { consumer: name }, select: { lastSeq: true } });
    return c ? { lastSeq: c.lastSeq } : null;
  },
  async readBatch(afterSeq, limit, settledBefore) {
    const rows = await basePrisma.customerEvent.findMany({ where: { seq: { gt: afterSeq }, receivedAt: { lte: settledBefore } }, orderBy: { seq: "asc" }, take: limit });
    return rows as StoredEvent[];
  },
  async saveCursor(name, s) {
    const now = new Date();
    await basePrisma.eventCursor.upsert({
      where: { consumer: name },
      create: { consumer: name, lastSeq: s.lastSeq, lastReceivedAt: s.lastReceivedAt, lastRunAt: now, lastError: s.lastError, processedTotal: s.processed },
      update: { lastSeq: s.lastSeq, ...(s.lastReceivedAt ? { lastReceivedAt: s.lastReceivedAt } : {}), lastRunAt: now, lastError: s.lastError, processedTotal: { increment: s.processed } },
    });
  },
  async recordFailure(name, event, errorClass, maxAttempts) {
    const row = await basePrisma.eventDeadLetter.upsert({
      where: { eventId_consumer: { eventId: event.id, consumer: name } },
      create: { eventId: event.id, consumer: name, attempts: 1, errorClass, status: maxAttempts <= 1 ? "DEAD" : "RETRYING" },
      update: { attempts: { increment: 1 }, errorClass, lastFailedAt: new Date(), resolvedAt: null },
    });
    const status = row.attempts >= maxAttempts ? "DEAD" : "RETRYING";
    if (row.status !== status) await basePrisma.eventDeadLetter.update({ where: { id: row.id }, data: { status } });
    return { attempts: row.attempts, status };
  },
  async resolveFailure(name, event) {
    await basePrisma.eventDeadLetter.updateMany({ where: { eventId: event.id, consumer: name, status: { in: ["RETRYING", "DEAD"] } }, data: { status: "RESOLVED", resolvedAt: new Date() } });
  },
  async pending(afterSeq) {
    const agg = await basePrisma.customerEvent.aggregate({ where: { seq: { gt: afterSeq } }, _count: { _all: true }, _min: { receivedAt: true } });
    return { count: agg._count._all, oldestReceivedAt: agg._min.receivedAt };
  },
  async loadDeadLetter(id) {
    const l = await basePrisma.eventDeadLetter.findUnique({ where: { id }, include: { event: true } });
    if (!l) return null;
    return { letter: { eventId: l.eventId, consumer: l.consumer, attempts: l.attempts, status: l.status as "RETRYING" | "DEAD" | "RESOLVED", errorClass: l.errorClass }, event: l.event as StoredEvent };
  },
};

/** Registered consumers (they share the job's budget). Add one here. */
export const allConsumers = (): EventConsumer[] => [auditConsumer, dataHealthConsumer];

const DEFAULTS = { settleMs: 60_000, batchSize: 200, maxAttempts: 5 } as const;
/** The whole job shares one budget (the tick's 300 s window is shared with 30 other jobs; the nudger takes 90 s, events take at most 60 s). */
export const EVENT_JOB_BUDGET_MS = 60_000;

export async function runEventConsumers(over: Partial<RunOptions> = {}): Promise<Record<string, number | boolean>> {
  if (!customerEventsEnabled()) return { skipped: true } as never;
  const t0 = Date.now();
  const out: Record<string, number | boolean> = { consumers: 0, processed: 0, failed: 0, deadLettered: 0, skipped: 0 };
  for (const c of allConsumers()) {
    const left = EVENT_JOB_BUDGET_MS - (Date.now() - t0);
    if (left <= 1000) { out.stoppedEarly = true; break; }
    let r: RunSummary | null = null;
    try {
      r = await runConsumer(c, consumerStore, { ...DEFAULTS, now: () => new Date(), budgetMs: left, ...over });
    } catch {
      // One consumer's infrastructure failure (database down) never stops the others; the next tick tries again.
      out.failed = (out.failed as number) + 1;
      continue;
    }
    out.consumers = (out.consumers as number) + 1;
    out.processed = (out.processed as number) + r.processed;
    out.failed = (out.failed as number) + r.failed;
    out.deadLettered = (out.deadLettered as number) + r.deadLettered;
    out.skipped = (out.skipped as number) + r.skipped;
  }
  return out;
}

/** Control plane: the Retry button on a dead letter. */
export const retryDeadLetterById = (id: string) => retryDeadLetter(allConsumers(), consumerStore, id, { ...DEFAULTS, now: () => new Date(), budgetMs: 10_000 });

/** Control plane: depth and age of every consumer's backlog, for the Health tab. */
export async function readConsumerLag(now = new Date()) {
  const names = allConsumers().map((c) => c.name);
  const cursors = await basePrisma.eventCursor.findMany({ where: { consumer: { in: names } } });
  return Promise.all(
    names.map(async (name) => {
      const lag = await lagOf(consumerStore, name, now);
      const c = cursors.find((x) => x.consumer === name);
      return { consumer: name, ...lag, lastRunAt: c?.lastRunAt ?? null, lastError: c?.lastError ?? null, processedTotal: c?.processedTotal ?? 0 };
    }),
  );
}

/** Replay: reset a consumer's cursor. Replays never send: outbound consumers refuse to run while `replay` is set (see runConsumer). */
export async function resetCursor(consumer: string, toSeq: bigint = BigInt(0)): Promise<void> {
  await basePrisma.eventCursor.upsert({ where: { consumer }, create: { consumer, lastSeq: toSeq }, update: { lastSeq: toSeq, lastError: null } });
}
