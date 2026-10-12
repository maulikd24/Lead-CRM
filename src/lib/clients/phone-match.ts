import { prisma } from "@/lib/db/prisma";

/**
 * Batch phone lookup: maps identity keys (src/lib/clients/identity-keys.ts) to a client, optionally limited to
 * clients assigned to a set of users (null = unrestricted). Excludes archived/merged clients; when several share a
 * number the earliest-created wins — the existing duplicate-handling precedent.
 */
export async function findClientsByPhoneKeys(keys: string[], visibleUserIds: string[] | null): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (keys.length === 0) return result;
  const rows = await prisma.client.findMany({
    where: {
      mobileKey: { in: keys },
      isDeleted: false,
      mergedIntoId: null,
      ...(visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {}),
    },
    select: { id: true, mobileKey: true },
    orderBy: { createdAt: "desc" },
  });
  // Newest-first, so writing into the map in order leaves the earliest-created client as the winner.
  for (const row of rows) if (row.mobileKey) result.set(row.mobileKey, row.id);
  return result;
}
