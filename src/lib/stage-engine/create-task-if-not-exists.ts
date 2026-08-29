import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/activities/log-activity";
import { syncNextAction } from "@/lib/stage-engine/next-action";
import type { Task } from "@/generated/prisma/client";

/**
 * Creates a stage-engine-generated Task unless an open one from the same
 * source already exists for this client (guards against double-submission
 * creating duplicate follow-ups, e.g. a double-clicked "Submit for KYC").
 * Always resyncs Client.nextAction* afterward so callers don't need to.
 */
export async function createTaskIfNotExists(data: {
  clientId: string;
  assignedToId: string;
  title: string;
  dueAt: Date;
  source: string;
}): Promise<Task> {
  const existing = await prisma.task.findFirst({
    where: { clientId: data.clientId, source: data.source, status: { in: ["PENDING", "OVERDUE"] } },
  });

  if (existing) {
    if (existing.title !== data.title) {
      await logActivity({
        clientId: data.clientId,
        type: "NOTE",
        payload: {
          message: `Skipped creating duplicate task "${data.title}" — an open task from "${data.source}" already exists ("${existing.title}")`,
        },
      });
    }
    return existing;
  }

  const task = await prisma.task.create({ data });
  await syncNextAction(data.clientId);
  return task;
}
