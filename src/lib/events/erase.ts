import { Prisma } from "@/generated/prisma/client";
import type { prisma } from "@/lib/db/prisma";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Erasure for the event tables (EVENT_TAXONOMY section 4): the facts stay, the person goes.
 * - CustomerEvent keeps id, type, times, correlation and the customer id (a random id with no meaning outside this database); its metadata,
 *   consent snapshot and customer actor id are nulled, and the dedupe key is replaced by a one-way hash so nothing derived from an external
 *   identifier survives while the (source, key) uniqueness still holds.
 * - Emit failure records and data-health work items about the customer are deleted.
 * Runs in the erasure transaction, in BOTH the legacy and the registry-driven paths (these tables are new, so they have no legacy step).
 */
export async function eraseEventTraces(tx: Tx, ids: string[]): Promise<{ events: number; failures: number; items: number }> {
  if (ids.length === 0) return { events: 0, failures: 0, items: 0 };
  const events = await tx.$executeRaw`UPDATE "CustomerEvent" SET "metadata" = NULL, "consentContext" = NULL, "actorId" = CASE WHEN "actorType" IN ('customer', 'partner') THEN NULL ELSE "actorId" END, "dedupeKey" = 'erased:' || md5("dedupeKey") WHERE "clientId" IN (${Prisma.join(ids)}) AND "dedupeKey" NOT LIKE 'erased:%'`;
  const failures = await tx.eventEmitFailure.deleteMany({ where: { clientId: { in: ids } } });
  const items = await tx.dataHealthItem.deleteMany({ where: { clientId: { in: ids } } });
  return { events, failures: failures.count, items: items.count };
}
