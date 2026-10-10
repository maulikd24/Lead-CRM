import { Prisma } from "@/generated/prisma/client";
import type { basePrisma } from "@/lib/db/prisma";
import { contactFromPayload, type BackfillDeps, type StaleRow } from "./backfill";
import { APP_SIGNUP_SOURCE, resolveLiveClientId } from "./identity";

type Db = typeof basePrisma;
const REACHED = ["CREATED", "DUPLICATE"] as const;

/** Signup ledger rows worth a look: they point at nobody, or at a customer that was merged away. Row order is stable. */
export async function listBackfillCandidates(db: Db, limit: number): Promise<StaleRow[]> {
  const unlinked = await db.leadIntake.findMany({
    where: { source: APP_SIGNUP_SOURCE, status: { in: [...REACHED] }, clientId: null },
    orderBy: { receivedAt: "asc" },
    take: limit,
    select: { id: true, externalId: true, clientId: true, rawPayload: true },
  });
  const mergedAway = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT li."id" FROM "LeadIntake" li JOIN "Client" c ON c."id" = li."clientId"
    WHERE li."source" = ${APP_SIGNUP_SOURCE} AND li."status" IN ('CREATED', 'DUPLICATE') AND c."mergedIntoId" IS NOT NULL
    ORDER BY li."receivedAt" ASC LIMIT ${limit}`);
  const merged = mergedAway.length
    ? await db.leadIntake.findMany({ where: { id: { in: mergedAway.map((r) => r.id) } }, orderBy: { receivedAt: "asc" }, select: { id: true, externalId: true, clientId: true, rawPayload: true } })
    : [];
  return [...unlinked, ...merged].map((r) => ({ id: r.id, externalId: r.externalId, clientId: r.clientId, ...contactFromPayload(r.rawPayload) }));
}

/** The real dependencies. `actorId` is the Admin the audit entries are written as (required to apply). */
export function prismaBackfillDeps(db: Db, actorId: string | null): BackfillDeps {
  return {
    resolveLive: (clientId) => resolveLiveClientId(db, clientId),
    clientsByPhoneKey: async (key) => {
      const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "Client"
        WHERE "isDeleted" = false AND "mergedIntoId" IS NULL AND "mobile" IS NOT NULL
          AND right(regexp_replace("mobile", '[^0-9]', '', 'g'), 10) = ${key}
        LIMIT 3`);
      return rows.map((r) => r.id);
    },
    clientsByEmail: async (email) => (await db.client.findMany({ where: { email: { equals: email, mode: "insensitive" }, mergedIntoId: null, isDeleted: false }, select: { id: true }, take: 3 })).map((c) => c.id),
    appIdsOf: async (clientId) =>
      (await db.leadIntake.findMany({ where: { source: APP_SIGNUP_SOURCE, clientId, status: { in: [...REACHED] } }, select: { externalId: true }, take: 10 })).map((r) => r.externalId),
    link: async (rowId, from, to) => {
      if (!actorId) throw new Error("An actor is required to apply the backfill (the audit trail names who ran it).");
      return db.$transaction(async (tx) => {
        const res = await tx.leadIntake.updateMany({ where: { id: rowId, source: APP_SIGNUP_SOURCE, clientId: from }, data: { clientId: to } });
        if (res.count !== 1) return false;
        await tx.auditLog.create({ data: { userId: actorId, entity: "LeadIntake", entityId: rowId, action: "app_id_backfill", newValue: { fromClientId: from, toClientId: to } } });
        return true;
      });
    },
  };
}
