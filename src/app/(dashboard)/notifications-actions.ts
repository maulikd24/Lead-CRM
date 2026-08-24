"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";

export async function markNotificationReadAction(notificationId: string) {
  const session = await requireUser();

  await prisma.notification.updateMany({
    where: { id: notificationId, userId: session.user.id },
    data: { readAt: new Date() },
  });

  revalidatePath("/leads");
}

export async function markAllNotificationsReadAction() {
  const session = await requireUser();

  await prisma.notification.updateMany({
    where: { userId: session.user.id, readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath("/leads");
}
