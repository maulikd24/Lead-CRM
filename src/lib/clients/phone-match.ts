import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * Batch cross-format phone lookup: maps last-10-digit keys to a client. Same comparison as
 * findClientByPhoneKey (digits-only, last 10, excludes archived/merged) but for many numbers at once and
 * optionally limited to clients assigned to a set of users (null = unrestricted). When several clients
 * share a number the earliest-created wins — the existing duplicate-handling precedent.
 */
export async function findClientsByPhoneKeys(keys: string[], visibleUserIds: string[] | null): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (keys.length === 0) return result;

  const scope = visibleUserIds ? Prisma.sql`AND "assignedToId" = ANY(${visibleUserIds}::text[])` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ id: string; key: string }[]>`
    SELECT id, right(regexp_replace(mobile, '[^0-9]', '', 'g'), 10) AS key
    FROM "Client"
    WHERE "isDeleted" = false
      AND "mergedIntoId" IS NULL
      AND mobile IS NOT NULL
      AND right(regexp_replace(mobile, '[^0-9]', '', 'g'), 10) = ANY(${keys}::text[])
      ${scope}
    ORDER BY "createdAt" DESC`;
  // Ordered newest-first so that, writing into the map in order, the earliest-created client ends up last (wins).
  for (const row of rows) result.set(row.key, row.id);
  return result;
}
