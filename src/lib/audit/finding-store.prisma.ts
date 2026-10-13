/**
 * Prisma implementation of FindingDbPort. Storage calls only; the rules live in finding-store.ts and findings.ts.
 */
import type { PrismaClient } from "@/generated/prisma/client";

import type { FindingDbPort, FindingRow, StoredFinding } from "./finding-store";

export function prismaFindingPort(db: PrismaClient): FindingDbPort {
  return {
    async insertIfAbsent(rows: readonly FindingRow[]): Promise<number> {
      // skipDuplicates relies on the unique index on dedupeKey: a row already stored for the same record and category is skipped.
      const result = await db.auditFinding.createMany({
        data: rows.map((r) => ({
          clientId: r.clientId,
          subjectUserId: r.subjectUserId,
          source: r.source,
          category: r.category,
          severity: r.severity,
          summary: r.summary,
          evidenceRef: r.evidenceRef,
          dedupeKey: r.dedupeKey,
          detectedAt: r.detectedAt,
        })),
        skipDuplicates: true,
      });
      return result.count;
    },

    async openForClient(clientId: string): Promise<StoredFinding[]> {
      const rows = await db.auditFinding.findMany({
        where: { clientId, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
        select: { category: true, severity: true, detectedAt: true },
      });
      return rows;
    },
  };
}
