"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { notificationVisibleWhere } from "@/lib/access/notification-policy";
import { requireAccess } from "@/lib/auth/require-role";

export async function markNotificationReadAction(notificationId: string) {
  const session = await requireAccess("notifications", "manage");

  await prisma.notification.updateMany({
    where: { id: notificationId, userId: session.user.id },
    data: { readAt: new Date() },
  });

  revalidatePath("/", "layout");
}

export async function markAllNotificationsReadAction() {
  const session = await requireAccess("notifications", "manage");

  await prisma.notification.updateMany({
    where: { userId: session.user.id, readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath("/", "layout");
}

export async function getRecentNotificationsAction() {
  const session = await requireAccess("notifications", "manage");

  return prisma.notification.findMany({
    where: { userId: session.user.id, ...notificationVisibleWhere(session.user.role) },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

const SLA_BREACH_TYPES = ["stage_sla_breach", "task_overdue", "task_overdue_escalation"];

/** Polled client-side to drive browser-level notification popups for RMs/Managers while logged in. */
export async function getNewSlaBreachNotificationsAction(sinceIso: string) {
  const session = await requireAccess("notifications", "manage");
  if (session.user.role !== "RM" && session.user.role !== "MANAGER") return [];

  return prisma.notification.findMany({
    where: {
      userId: session.user.id,
      readAt: null,
      type: { in: SLA_BREACH_TYPES },
      createdAt: { gt: new Date(sinceIso) },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
}
