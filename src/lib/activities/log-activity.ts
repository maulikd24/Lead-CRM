import { prisma } from "@/lib/db/prisma";
import type { ActivityType, Prisma } from "@/generated/prisma/client";

export async function logActivity(params: {
  clientId: string;
  userId?: string | null;
  type: ActivityType;
  payload: Prisma.InputJsonValue;
  /** Back-dates the row (e.g. a synced phone call) — defaults to now. */
  createdAt?: Date;
}) {
  return prisma.activity.create({
    data: {
      clientId: params.clientId,
      userId: params.userId ?? null,
      type: params.type,
      payload: params.payload,
      ...(params.createdAt ? { createdAt: params.createdAt } : {}),
    },
  });
}
