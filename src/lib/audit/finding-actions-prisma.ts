/**
 * Prisma implementation of FindingActionPort. Storage calls only; the rules live in finding-actions.ts.
 */
import type { prisma as AppPrisma } from "@/lib/db/prisma";

import type { FindingActionPort, FindingDbStatus } from "./finding-actions";

type Db = typeof AppPrisma;

export function prismaFindingActionPort(db: Db): FindingActionPort {
  return {
    async load(findingId) {
      const row = await db.auditFinding.findUnique({
        where: { id: findingId },
        select: { id: true, status: true, clientId: true, client: { select: { assignedToId: true } } },
      });
      if (!row) return null;
      return { id: row.id, status: row.status as FindingDbStatus, clientId: row.clientId, clientAssignedToId: row.client?.assignedToId ?? null };
    },

    async apply(input) {
      return db.$transaction(async (tx) => {
        const changed = await tx.auditFinding.updateMany({
          where: { id: input.findingId, status: { in: [...input.from] } },
          data: input.to === "RESOLVED" ? { status: "RESOLVED", resolvedAt: input.at, resolvedById: input.actorId } : { status: input.to },
        });
        if (changed.count !== 1) return false;
        await tx.auditLog.create({
          data: {
            userId: input.actorId,
            entity: "AuditFinding",
            entityId: input.findingId,
            action: `audit_finding.${input.action}`,
            oldValue: { status: input.fromStatus },
            newValue: { status: input.to },
            reason: input.note,
            timestamp: input.at,
          },
        });
        return true;
      });
    },
  };
}
