import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

import { emitWith, type EmitFailureRow, type EmitResult, type EventStore, type NewEventRow } from "./emit";
import type { EmitInput } from "./envelope";
import { customerEventsEnabled } from "./flag";

/** The transaction client handed to `prisma.$transaction(async (tx) => ...)` (the app client is extended, so the stock Prisma type does not fit). */
export type EventTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type Client = EventTx | typeof prisma;

const json = (v: unknown) => (v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue));

let savepoints = 0;

/**
 * Real store. `insert` is `INSERT ... ON CONFLICT DO NOTHING` (createMany with skipDuplicates), so a duplicate is a normal answer, not an
 * error. Inside a caller's transaction every write is wrapped in a SAVEPOINT: if it fails, only the savepoint rolls back, the caller's
 * transaction is NOT aborted and its domain write still commits.
 */
export function prismaEventStore(client: Client, opts: { savepoint: boolean }): EventStore {
  const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
    if (!opts.savepoint) return work();
    const name = `ce_sp_${++savepoints}`;
    const tx = client as EventTx;
    await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
    try {
      const result = await work();
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => {});
      throw error;
    }
  };
  return {
    insert: (row: NewEventRow) =>
      guarded(async () => {
        const out = await client.customerEvent.createMany({
          data: [{ ...row, consentContext: json(row.consentContext), metadata: json(row.metadata) }],
          skipDuplicates: true,
        });
        return out.count === 1 ? ("inserted" as const) : ("duplicate" as const);
      }),
    recordFailure: (f: EmitFailureRow) =>
      guarded(async () => {
        await client.eventEmitFailure.create({ data: { eventType: f.eventType, source: f.source, dedupeKey: f.dedupeKey, clientId: f.clientId, reason: f.reason, detail: f.detail, envelope: json(f.envelope) } });
      }),
  };
}

const deps = (client: Client, savepoint: boolean) => ({ store: prismaEventStore(client, { savepoint }), enabled: () => customerEventsEnabled() });

/**
 * Best effort, outside any transaction: call it AFTER the domain write has committed. Never throws.
 * Use `emitEventInTx` instead where the fact and the domain row must commit together.
 */
export async function emitEvent(input: EmitInput): Promise<EmitResult> {
  return emitWith(deps(prisma, false), input);
}

/**
 * Transactional outbox: the event row commits (or rolls back) with the caller's domain write. A failure to store the event never aborts
 * the caller's transaction (savepoint), and never throws. With the flag off it does not even open a savepoint.
 */
export async function emitEventInTx(tx: EventTx, input: EmitInput): Promise<EmitResult> {
  if (!customerEventsEnabled()) return { status: "disabled" };
  return emitWith(deps(tx, true), input);
}
