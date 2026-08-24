import { prisma } from "@/lib/db/prisma";

/** Flags PENDING tasks past their due date as OVERDUE and notifies the assignee (and their manager, if severely overdue). */
export async function checkOverdueTasks() {
  const now = new Date();

  const overdueTasks = await prisma.task.findMany({
    where: { status: "PENDING", dueAt: { lt: now } },
    include: { assignedTo: true, client: true },
  });

  for (const task of overdueTasks) {
    await prisma.task.update({ where: { id: task.id }, data: { status: "OVERDUE" } });

    await prisma.notification.create({
      data: {
        userId: task.assignedToId,
        type: "task_overdue",
        payload: { taskId: task.id, taskTitle: task.title, clientId: task.clientId, clientName: task.client.name },
      },
    });

    const hoursOverdue = (now.getTime() - task.dueAt.getTime()) / (1000 * 60 * 60);
    if (hoursOverdue > 24 && task.assignedTo.managerId) {
      await prisma.notification.create({
        data: {
          userId: task.assignedTo.managerId,
          type: "task_overdue_escalation",
          payload: {
            taskId: task.id,
            taskTitle: task.title,
            clientId: task.clientId,
            clientName: task.client.name,
            assignedToName: task.assignedTo.name,
          },
        },
      });
    }
  }

  return { flagged: overdueTasks.length };
}
