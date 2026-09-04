import { prisma } from "@/lib/db/prisma";
import { getHeldDurationMs, effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";
import { createTaskIfNotExists } from "@/lib/stage-engine/create-task-if-not-exists";
import { sendFundingSlaBreachEmail } from "@/lib/notifications/send-sla-breach-email";

const FUNDING_TASK_THRESHOLD_HOURS = 24;
const FUNDING_ESCALATION_THRESHOLD_HOURS = 48;

/**
 * Sweeps active clients sitting in "KYC completed" with no funding record or a still-PENDING
 * one. This is a dedicated funding clock, independent of the stage's own configurable SLA hours:
 * 24h (held-duration adjusted) after entering the stage, auto-creates a follow-up task for the
 * assigned RM; 48h after, escalates to the RM's manager via notification + email. Idempotent the
 * same way checkStageSla is (skips if an unread escalation notification already exists).
 */
export async function checkFundingSla() {
  const now = new Date();

  const clients = await prisma.client.findMany({
    where: {
      status: "ACTIVE",
      currentStage: { name: "KYC completed" },
      OR: [{ fundingRecord: null }, { fundingRecord: { status: "PENDING" } }],
    },
    include: { currentStage: true, assignedTo: true },
    take: 200,
  });

  let tasksCreated = 0;
  let escalated = 0;

  for (const client of clients) {
    const heldMs = await getHeldDurationMs(client.id, client.currentStageId, now);
    const effectiveEnteredAt = effectiveStageEnteredAt(client.stageEnteredAt, heldMs);
    const elapsedHours = (now.getTime() - effectiveEnteredAt.getTime()) / (1000 * 60 * 60);

    if (elapsedHours >= FUNDING_TASK_THRESHOLD_HOURS && client.assignedToId) {
      await createTaskIfNotExists({
        clientId: client.id,
        assignedToId: client.assignedToId,
        title: "Follow up: funding still pending (24h)",
        dueAt: now,
        source: "funding-sla:pending-24h",
      });
      tasksCreated += 1;
    }

    if (elapsedHours >= FUNDING_ESCALATION_THRESHOLD_HOURS) {
      const alreadyNotified = await prisma.notification.findFirst({
        where: {
          type: "funding_sla_pending_escalation",
          readAt: null,
          payload: { path: ["clientId"], equals: client.id },
        },
      });
      if (alreadyNotified) continue;

      escalated += 1;

      if (client.assignedTo?.managerId) {
        await prisma.notification.create({
          data: {
            userId: client.assignedTo.managerId,
            type: "funding_sla_pending_escalation",
            payload: {
              clientId: client.id,
              clientName: client.name,
              assignedToName: client.assignedTo.name,
              hoursElapsed: Math.round(elapsedHours),
            },
          },
        });
      }

      await sendFundingSlaBreachEmail(client);
    }
  }

  return { tasksCreated, escalated };
}
