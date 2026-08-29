import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Recomputes Client.nextActionTitle/nextActionDueAt/nextActionOwnerId from the
 * earliest still-open Task for this client. This is a read-optimized cache —
 * it is the ONLY place that should ever write these fields, and nothing that
 * needs correctness guarantees (e.g. stage gates) should trust it; query Task
 * directly there instead.
 */
export async function syncNextAction(clientId: string, db: Db = prisma): Promise<void> {
  const nextTask = await db.task.findFirst({
    where: { clientId, status: { in: ["PENDING", "OVERDUE"] } },
    orderBy: { dueAt: "asc" },
    select: { title: true, dueAt: true, assignedToId: true },
  });

  await db.client.update({
    where: { id: clientId },
    data: {
      nextActionTitle: nextTask?.title ?? null,
      nextActionDueAt: nextTask?.dueAt ?? null,
      nextActionOwnerId: nextTask?.assignedToId ?? null,
    },
  });
}
