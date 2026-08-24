import { prisma } from "@/lib/db/prisma";
import type { ActivityType, Prisma } from "@/generated/prisma/client";

export async function logActivity(params: {
  leadId: string;
  userId?: string | null;
  type: ActivityType;
  payload: Prisma.InputJsonValue;
}) {
  return prisma.activity.create({
    data: {
      leadId: params.leadId,
      userId: params.userId ?? null,
      type: params.type,
      payload: params.payload,
    },
  });
}
