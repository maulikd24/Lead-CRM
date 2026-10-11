import { errorClassOf } from "@/lib/system/job-run";

import type { StoredEvent } from "./envelope";

/**
 * Cursor-based event consumers (EVENT_TAXONOMY section 4). Prisma-free: the store is injected (consumers-db.ts wires Postgres), so the
 * delivery rules are unit tests.
 *
 * - At-least-once. A consumer's cursor moves only past events its handler finished (or that were dead-lettered). A crash between the
 *   handler and the cursor write re-delivers the event, so every handler MUST be idempotent.
 * - Order is receipt order (seq). Consumers must not assume occurred_at order: late events arrive late.
 * - A failing event stops that consumer (order is kept) and is retried next tick; after `maxAttempts` it is moved to the dead letter
 *   list and the cursor goes past it. Nothing is dropped silently, nothing blocks a consumer forever.
 * - Events only count once they have SETTLED (received_at older than the settle window): a transaction that commits after a later one
 *   can therefore never be skipped by the cursor.
 * - Replay (a cursor reset) never sends: a consumer with outbound side effects refuses to run in replay mode, and never receives a late event.
 */

export type ConsumerContext = { replay: boolean; now: Date };

export type EventConsumer = {
  /** Cursor key and dead letter key. Never rename a live consumer: a new name starts from the beginning. */
  name: string;
  /** Exact types or `domain.*` prefixes. Omitted: every type. */
  types?: readonly string[];
  /** `outbound` consumers can send or write to a vendor: they are refused in replay mode and skip late events. */
  sideEffects: "none" | "outbound";
  handle(event: StoredEvent, ctx: ConsumerContext): Promise<void>;
};

export type DeadLetterState = { eventId: string; consumer: string; attempts: number; status: "RETRYING" | "DEAD" | "RESOLVED"; errorClass: string | null };

export interface ConsumerStore {
  getCursor(name: string): Promise<{ lastSeq: bigint } | null>;
  /** Events after `afterSeq`, in seq order, received at or before `settledBefore`. */
  readBatch(afterSeq: bigint, limit: number, settledBefore: Date): Promise<StoredEvent[]>;
  saveCursor(name: string, state: { lastSeq: bigint; lastReceivedAt: Date | null; processed: number; lastError: string | null }): Promise<void>;
  recordFailure(name: string, event: StoredEvent, errorClass: string, maxAttempts: number): Promise<{ attempts: number; status: "RETRYING" | "DEAD" }>;
  resolveFailure(name: string, event: StoredEvent): Promise<void>;
  pending(afterSeq: bigint): Promise<{ count: number; oldestReceivedAt: Date | null }>;
  loadDeadLetter(id: string): Promise<{ letter: DeadLetterState; event: StoredEvent } | null>;
}

export type RunOptions = {
  now: () => Date;
  settleMs: number;
  batchSize: number;
  budgetMs: number;
  maxAttempts: number;
  replay?: boolean;
  /** Monotonic milliseconds for the budget; injected so tests do not sleep. */
  clock?: () => number;
};

export type RunSummary = { consumer: string; processed: number; skipped: number; failed: number; deadLettered: number; stoppedEarly: boolean; refused?: "replay"; lastSeq: bigint };

const matches = (types: readonly string[] | undefined, type: string) => !types || types.some((t) => (t.endsWith(".*") ? type.startsWith(t.slice(0, -1)) : t === type));

export async function runConsumer(consumer: EventConsumer, store: ConsumerStore, o: RunOptions): Promise<RunSummary> {
  const clock = o.clock ?? Date.now;
  const cursor = await store.getCursor(consumer.name);
  const start = cursor?.lastSeq ?? BigInt(0);
  const summary: RunSummary = { consumer: consumer.name, processed: 0, skipped: 0, failed: 0, deadLettered: 0, stoppedEarly: false, lastSeq: start };
  if (o.replay && consumer.sideEffects === "outbound") return { ...summary, refused: "replay" };

  const t0 = clock();
  const now = o.now();
  const batch = await store.readBatch(start, o.batchSize, new Date(now.getTime() - o.settleMs));
  let lastReceivedAt: Date | null = null;
  let lastError: string | null = null;

  for (const event of batch) {
    if (clock() - t0 >= o.budgetMs) { summary.stoppedEarly = true; break; }
    const wanted = matches(consumer.types, event.eventType) && !(consumer.sideEffects === "outbound" && event.late);
    if (wanted) {
      try {
        await consumer.handle(event, { replay: o.replay === true, now });
        await store.resolveFailure(consumer.name, event);
        summary.processed += 1;
      } catch (error) {
        lastError = errorClassOf(error);
        const f = await store.recordFailure(consumer.name, event, lastError, o.maxAttempts);
        if (f.status === "DEAD") {
          summary.deadLettered += 1;
        } else {
          summary.failed += 1;
          break; // keep order: this event is retried next tick, nothing after it moves
        }
      }
    } else {
      summary.skipped += 1;
    }
    summary.lastSeq = BigInt(event.seq);
    lastReceivedAt = event.receivedAt;
  }

  await store.saveCursor(consumer.name, { lastSeq: summary.lastSeq, lastReceivedAt, processed: summary.processed, lastError });
  return summary;
}

/** Re-runs one dead-lettered event through its consumer (the control plane's Retry button). Never moves the cursor. */
export async function retryDeadLetter(consumers: readonly EventConsumer[], store: ConsumerStore, deadLetterId: string, o: RunOptions): Promise<{ ok: true } | { ok: false; reason: string }> {
  const found = await store.loadDeadLetter(deadLetterId);
  if (!found) return { ok: false, reason: "not_found" };
  const consumer = consumers.find((c) => c.name === found.letter.consumer);
  if (!consumer) return { ok: false, reason: "unknown_consumer" };
  if (consumer.sideEffects === "outbound") return { ok: false, reason: "outbound_consumers_are_not_retried_by_hand" };
  try {
    await consumer.handle(found.event, { replay: false, now: o.now() });
    await store.resolveFailure(consumer.name, found.event);
    return { ok: true };
  } catch (error) {
    await store.recordFailure(consumer.name, found.event, errorClassOf(error), o.maxAttempts);
    return { ok: false, reason: "handler_failed" };
  }
}

/** Consumer lag: how many events wait and how old the oldest is (EVENT_TAXONOMY section 7; the revisit trigger is lag over 15 minutes). */
export async function lagOf(store: ConsumerStore, name: string, now: Date): Promise<{ pending: number; lagSeconds: number }> {
  const cursor = await store.getCursor(name);
  const p = await store.pending(cursor?.lastSeq ?? BigInt(0));
  return { pending: p.count, lagSeconds: p.oldestReceivedAt ? Math.max(0, Math.floor((now.getTime() - p.oldestReceivedAt.getTime()) / 1000)) : 0 };
}
