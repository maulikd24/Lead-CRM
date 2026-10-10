import { Prisma } from "@/generated/prisma/client";
import { APP_SIGNUP_SOURCE } from "./identity";

/**
 * Who a CleverTap batch may pick. The app user id lives in the signup ledger (LeadIntake), which has no relation to Client,
 * so the selection is one SQL query. A customer is eligible when it is ACTIVE, live (not deleted, not merged away), has an
 * email or mobile, and has EXACTLY ONE usable app user id. Customers with none (not app users) or several (ambiguous, the
 * pusher would skip them) are never picked, so a batch is never spent on a guaranteed skip.
 */
export type SelectDb = { eligibleClientIds(args: { limit: number; marketingEvidence: boolean }): Promise<string[]> };
export type RawDb = { $queryRaw(query: Prisma.Sql): Promise<unknown> };

// The ledger ids that count: the same rule as identity.ts (trimmed, 1 to 200 characters, a signup that reached a customer).
const APP_ID_COUNTS = Prisma.sql`
  SELECT li."clientId", COUNT(DISTINCT trim(li."externalId")) AS n
  FROM "LeadIntake" li
  WHERE li."source" = ${Prisma.raw(`'${APP_SIGNUP_SOURCE}'`)}
    AND li."status" IN ('CREATED', 'DUPLICATE')
    AND li."clientId" IS NOT NULL
    AND char_length(trim(li."externalId")) BETWEEN 1 AND 200
  GROUP BY li."clientId"`;

const LIVE_CONTACTABLE = Prisma.sql`
  c."status" = 'ACTIVE' AND c."isDeleted" = false AND c."mergedIntoId" IS NULL
  AND ((c."email" IS NOT NULL AND c."email" <> '') OR (c."mobile" IS NOT NULL AND c."mobile" <> ''))`;

/** Mirrors coarseMarketingWhere (consent/coarse.ts): no marketing consent evidence at all can never be allowed. */
const MARKETING_EVIDENCE = Prisma.sql`
  AND (c."marketingConsentAt" IS NOT NULL OR EXISTS (
    SELECT 1 FROM "ConsentRecord" r WHERE r."clientId" = c."id" AND r."purpose" = 'MARKETING_COMMS' AND r."status" = 'GRANTED'))`;

/** Never-checked first (oldest first), then least recently checked: a customer with no ledger row sorts as null, which is first. */
export function eligibleSql(limit: number, marketingEvidence: boolean): Prisma.Sql {
  return Prisma.sql`
    SELECT c."id" FROM "Client" c
    LEFT JOIN "CleverTapSync" s ON s."clientId" = c."id"
    WHERE ${LIVE_CONTACTABLE}
      AND c."id" IN (SELECT a."clientId" FROM (${APP_ID_COUNTS}) a WHERE a.n = 1)
      ${marketingEvidence ? MARKETING_EVIDENCE : Prisma.empty}
    ORDER BY s."lastCheckedAt" ASC NULLS FIRST, c."createdAt" ASC
    LIMIT ${limit}`;
}

export function prismaSelectDb(db: RawDb): SelectDb {
  return {
    async eligibleClientIds({ limit, marketingEvidence }) {
      const rows = (await db.$queryRaw(eligibleSql(limit, marketingEvidence))) as { id: string }[];
      return rows.map((r) => r.id);
    },
  };
}

export async function selectBatch(db: SelectDb, limit: number, opts: { marketingEvidence?: boolean } = {}): Promise<string[]> {
  return db.eligibleClientIds({ limit, marketingEvidence: !!opts.marketingEvidence });
}

export type IdentityCoverage = { eligible: number; noAppId: number; multipleAppIds: number };

/** The same customer population as the batch, in three buckets. Shown on the CleverTap integration card. */
export function coverageSql(): Prisma.Sql {
  return Prisma.sql`
    SELECT
      (COUNT(*) FILTER (WHERE e.n = 1))::int AS "eligible",
      (COUNT(*) FILTER (WHERE e.n IS NULL))::int AS "noAppId",
      (COUNT(*) FILTER (WHERE e.n > 1))::int AS "multipleAppIds"
    FROM "Client" c
    LEFT JOIN (${APP_ID_COUNTS}) e ON e."clientId" = c."id"
    WHERE ${LIVE_CONTACTABLE}`;
}

export async function loadIdentityCoverage(db: RawDb): Promise<IdentityCoverage> {
  const rows = (await db.$queryRaw(coverageSql())) as { eligible: unknown; noAppId: unknown; multipleAppIds: unknown }[];
  const r = rows[0];
  return { eligible: Number(r?.eligible ?? 0), noAppId: Number(r?.noAppId ?? 0), multipleAppIds: Number(r?.multipleAppIds ?? 0) };
}
