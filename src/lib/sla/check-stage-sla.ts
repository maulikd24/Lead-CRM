import { prisma } from "@/lib/db/prisma";
import { computeSlaStatus, isReferralLeadSource } from "@/lib/stage-engine/sla-status";
import { sendSlaBreachEmail } from "@/lib/notifications/send-sla-breach-email";

/**
 * Sweeps active clients and notifies on stage-SLA breach. SLA status itself is computed on
 * read (client list/dashboard) via computeSlaStatus — this only handles the notification side.
 * Two alerts per stage visit, each sent once: "about to breach" (75% of the SLA — DUE_SOON) and the
 * breach itself. Idempotency is "already notified since the client entered this stage", deliberately
 * ignoring whether the earlier alert was read — otherwise reading it would let the next 5-minute tick
 * create it (and buzz the user's phone) again.
 */
export async function checkStageSla() {
  const now = new Date();

  const clients = await prisma.client.findMany({
    where: { status: "ACTIVE" },
    include: { currentStage: true, assignedTo: true },
    orderBy: { stageEnteredAt: "asc" },
    take: 200,
  });

  let breached = 0;
  let dueSoon = 0;

  for (const client of clients) {
    if (isReferralLeadSource(client.leadSource)) continue;

    const status = computeSlaStatus(client.stageEnteredAt, client.currentStage.slaHours, now);

    if (status === "DUE_SOON") {
      const alreadyWarned = await prisma.notification.findFirst({
        where: {
          type: "stage_sla_due_soon",
          createdAt: { gte: client.stageEnteredAt },
          payload: { path: ["clientId"], equals: client.id },
        },
      });
      if (alreadyWarned || !client.assignedToId) continue;

      const hoursLeft = Math.max(
        1,
        Math.round(client.currentStage.slaHours - (now.getTime() - client.stageEnteredAt.getTime()) / (1000 * 60 * 60)),
      );
      await prisma.notification.create({
        data: {
          userId: client.assignedToId,
          type: "stage_sla_due_soon",
          payload: { clientId: client.id, clientName: client.name, stage: client.currentStage.name, hoursLeft },
        },
      });
      dueSoon += 1;
      continue;
    }

    if (status !== "OVERDUE") continue;

    const alreadyNotified = await prisma.notification.findFirst({
      where: {
        type: "stage_sla_breach",
        createdAt: { gte: client.stageEnteredAt },
        payload: { path: ["clientId"], equals: client.id },
      },
    });
    if (alreadyNotified) continue;

    breached += 1;

    if (client.assignedToId) {
      await prisma.notification.create({
        data: {
          userId: client.assignedToId,
          type: "stage_sla_breach",
          payload: { clientId: client.id, clientName: client.name, stage: client.currentStage.name },
        },
      });

      if (client.priority === "HIGH" && client.assignedTo?.managerId) {
        await prisma.notification.create({
          data: {
            userId: client.assignedTo.managerId,
            type: "stage_sla_breach",
            payload: {
              clientId: client.id,
              clientName: client.name,
              stage: client.currentStage.name,
              assignedToName: client.assignedTo.name,
              escalated: true,
            },
          },
        });
      }

      await sendSlaBreachEmail(client);
    }
  }

  return { breached, dueSoon };
}
