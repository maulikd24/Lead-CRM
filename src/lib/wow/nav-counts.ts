import { prisma } from "@/lib/db/prisma";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import type { Role } from "@/generated/prisma/client";

const DESK_ROLES: Role[] = ["ADMIN", "MANAGER", "RM"];

/**
 * The small numbers beside sidebar items, scoped exactly like the pages they point at: conversations with an unread customer
 * message (Inbox) and tasks past their due time (Tasks). Roles without those screens cost no queries. A failure here must never
 * break the page, so it returns no counts.
 */
export async function getNavCounts(userId: string, role: Role): Promise<Record<string, number>> {
  if (!DESK_ROLES.includes(role)) return {};
  try {
    const visible = await getVisibleUserIds(userId, role);
    const clientWhere = visible ? { assignedToId: { in: visible }, isDeleted: false } : { isDeleted: false };
    const [unread, overdue] = await Promise.all([
      prisma.message.groupBy({ by: ["clientId"], where: { direction: "INBOUND", readAt: null, client: clientWhere } }),
      prisma.task.count({ where: { ...(visible ? { assignedToId: { in: visible } } : {}), status: { in: ["PENDING", "OVERDUE"] }, dueAt: { lt: new Date() }, client: { isDeleted: false } } }),
    ]);
    return { "/inbox": unread.length, "/tasks": overdue };
  } catch {
    return {};
  }
}
