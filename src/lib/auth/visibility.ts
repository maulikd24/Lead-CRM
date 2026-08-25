import { prisma } from "@/lib/db/prisma";
import type { Role } from "@/generated/prisma/client";

/** Returns the set of user IDs whose leads/tasks a given user is allowed to see. */
export async function getVisibleUserIds(userId: string, role: Role): Promise<string[] | null> {
  if (role === "ADMIN") return null; // null = no restriction, see everyone
  if (role === "RM") return [userId];

  // MANAGER: self + direct reports. Intentionally not filtered by isActive — a
  // manager must keep seeing a removed report's existing clients/tasks, not lose them.
  const reports = await prisma.user.findMany({
    where: { managerId: userId },
    select: { id: true },
  });
  return [userId, ...reports.map((r) => r.id)];
}
