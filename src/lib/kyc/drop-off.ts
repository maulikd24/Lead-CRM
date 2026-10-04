import { prisma } from "@/lib/db/prisma";
import { createTaskIfNotExists } from "@/lib/stage-engine/create-task-if-not-exists";
import { DONE_STATUSES, KYC_STEP_BY_TYPE, actionableSteps } from "./steps";

const HOUR = 60 * 60 * 1000;

/** Every tick: find actionable KYC steps that have sat too long and re-engage.
 *  Level 1 (past the step's SLA): RM follow-up task + alert (Admins, if the client is unassigned).
 *  Level 2 (past 2x SLA): escalate to the RM's manager, or Admins if there is none.
 * Only clients actively in "Submitted for KYC" count — on-hold or closed clients aren't dropping off.
 * reminderLevel resets whenever the step changes status, so each stall escalates once. */
export async function checkKycDropOffs(now = new Date()) {
  const open = await prisma.kycStep.findMany({
    where: {
      status: { notIn: DONE_STATUSES },
      client: { status: "ACTIVE", isDeleted: false, currentStage: { name: "Submitted for KYC" } },
      OR: [{ holderId: null }, { holder: { isDeleted: false } }],
    },
    select: { clientId: true },
    distinct: ["clientId"],
  });
  if (open.length === 0) return { clients: 0, nudged: 0, escalated: 0 };

  const clientIds = open.map((s) => s.clientId);
  const [steps, clients, admins] = await Promise.all([
    prisma.kycStep.findMany({ where: { clientId: { in: clientIds }, OR: [{ holderId: null }, { holder: { isDeleted: false } }] }, include: { holder: { select: { name: true } } } }),
    prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true, assignedToId: true, assignedTo: { select: { name: true, managerId: true } } } }),
    prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } }),
  ]);
  const clientById = new Map(clients.map((c) => [c.id, c]));

  let nudged = 0;
  let escalated = 0;
  for (const clientId of clientIds) {
    const client = clientById.get(clientId)!;
    for (const step of actionableSteps(steps.filter((s) => s.clientId === clientId))) {
      const definition = KYC_STEP_BY_TYPE.get(step.type)!;
      const ageHours = (now.getTime() - step.statusChangedAt.getTime()) / HOUR;
      const target = ageHours >= definition.slaHours * 2 ? 2 : ageHours >= definition.slaHours ? 1 : 0;
      if (target <= step.reminderLevel) continue;

      // Claim the escalation: only one tick can move reminderLevel past its current value.
      const claimed = await prisma.kycStep.updateMany({ where: { id: step.id, reminderLevel: step.reminderLevel, status: step.status }, data: { reminderLevel: target } });
      if (claimed.count === 0) continue;

      const label = `${definition.label}${step.holder ? ` (${step.holder.name})` : ""}`;
      const payload = { clientId, clientName: client.name, step: label, hours: Math.floor(ageHours), status: step.status };

      if (step.reminderLevel < 1) {
        if (client.assignedToId) {
          await createTaskIfNotExists({
            clientId,
            assignedToId: client.assignedToId,
            title: `KYC stuck: ${label}`,
            dueAt: new Date(now.getTime() + 24 * HOUR),
            source: `kyc-step:${step.id}`,
          });
          await prisma.notification.create({ data: { userId: client.assignedToId, type: "kyc_step_stalled", payload } });
        } else {
          for (const admin of admins) await prisma.notification.create({ data: { userId: admin.id, type: "kyc_step_stalled", payload } });
        }
        nudged++;
      }
      if (target === 2) {
        const recipients = client.assignedTo?.managerId ? [client.assignedTo.managerId] : admins.map((a) => a.id);
        for (const userId of recipients) {
          await prisma.notification.create({ data: { userId, type: "kyc_step_escalated", payload: { ...payload, assignedToName: client.assignedTo?.name ?? "Unassigned" } } });
        }
        escalated++;
      }
    }
  }
  return { clients: clientIds.length, nudged, escalated };
}
