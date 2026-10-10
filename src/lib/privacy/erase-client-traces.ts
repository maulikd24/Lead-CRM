import type { prisma } from "@/lib/db/prisma";
import { APP_SIGNUP_SOURCE } from "@/lib/integrations/clevertap/identity";
import { erasedLedgerKey, isErasedLedgerKey } from "./erased-key";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type ErasedClient = { id: string; clientCode: string; mobile: string | null; email: string | null; mergedIntoId: string | null };

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);
const digits = (v: string | null) => (v ?? "").replace(/\D/g, "").slice(-10);

/**
 * Everything that holds a person's data but is NOT removed by deleting their child rows, run inside the erasure
 * transaction (before the Client row goes):
 *
 * - LeadIntake ledger (signup / lead webhooks): every row linked to the client, every app-signup row with one of the
 *   client's app user ids, and unlinked (rejected / failed) rows that still carry their email or phone, are reduced to a
 *   tombstone: rawPayload and error wiped, link removed, externalId replaced by a one-way hash (see erased-key.ts) so the
 *   (source, externalId) unique key still blocks a replay.
 * - Notification payloads that name the client (e.g. a "lead_reenquiry" with the customer's name) are deleted.
 * - A merge note on the survivor that names this person's record code is replaced by a neutral line.
 */
export async function eraseClientTraces(tx: Tx, client: ErasedClient): Promise<{ tombstoned: number }> {
  const linked = await tx.leadIntake.findMany({ where: { clientId: client.id }, select: { id: true, source: true, externalId: true } });
  const appIds = linked.filter((r) => r.source === APP_SIGNUP_SOURCE).map((r) => r.externalId);

  const ids = new Set(linked.map((r) => r.id));
  if (appIds.length) {
    const byAppId = await tx.leadIntake.findMany({ where: { source: APP_SIGNUP_SOURCE, externalId: { in: appIds } }, select: { id: true } });
    for (const r of byAppId) ids.add(r.id);
  }

  // Unlinked rows (REJECTED / ERROR: no client was ever attached) that still hold this person's contact details.
  const patterns: string[] = [];
  if (client.email) patterns.push(`%${escapeLike(client.email.toLowerCase())}%`);
  const phone = digits(client.mobile);
  const unlinked = new Set<string>();
  for (const pattern of patterns) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "LeadIntake" WHERE "clientId" IS NULL AND (lower("rawPayload"::text) LIKE ${pattern} OR lower(coalesce("error", '')) LIKE ${pattern} OR lower("externalId") LIKE ${pattern})`;
    rows.forEach((r) => unlinked.add(r.id));
  }
  if (phone.length >= 8) {
    const pattern = `%${phone}%`;
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "LeadIntake" WHERE "clientId" IS NULL AND (regexp_replace("rawPayload"::text, '\\D', '', 'g') LIKE ${pattern} OR regexp_replace(coalesce("error", ''), '\\D', '', 'g') LIKE ${pattern} OR regexp_replace("externalId", '\\D', '', 'g') LIKE ${pattern})`;
    rows.forEach((r) => unlinked.add(r.id));
  }
  unlinked.forEach((id) => ids.add(id));

  let tombstoned = 0;
  const rows = ids.size ? await tx.leadIntake.findMany({ where: { id: { in: [...ids] } }, select: { id: true, source: true, externalId: true } }) : [];
  for (const row of rows) {
    if (isErasedLedgerKey(row.externalId)) {
      // Already a tombstone (a second erasure touching the same id): just make sure nothing is attached.
      await tx.leadIntake.update({ where: { id: row.id }, data: { clientId: null, error: null, rawPayload: { erased: true } } });
      continue;
    }
    const key = erasedLedgerKey(row.source, row.externalId);
    if (await tx.leadIntake.findUnique({ where: { source_externalId: { source: row.source, externalId: key } }, select: { id: true } })) {
      await tx.leadIntake.delete({ where: { id: row.id } }); // the tombstone for this id already exists
    } else {
      await tx.leadIntake.update({ where: { id: row.id }, data: { externalId: key, clientId: null, error: null, rawPayload: { erased: true } } });
    }
    tombstoned++;
  }

  await tx.notification.deleteMany({ where: { payload: { path: ["clientId"], equals: client.id } } });

  if (client.mergedIntoId) {
    const notes = await tx.activity.findMany({ where: { clientId: client.mergedIntoId, type: "NOTE" }, select: { id: true, payload: true } });
    for (const note of notes) {
      const message = (note.payload as { message?: unknown } | null)?.message;
      if (typeof message === "string" && message.includes(`(${client.clientCode})`)) {
        await tx.activity.update({ where: { id: note.id }, data: { payload: { message: "A duplicate customer record that was merged into this one has been erased" } } });
      }
    }
  }

  return { tombstoned };
}
