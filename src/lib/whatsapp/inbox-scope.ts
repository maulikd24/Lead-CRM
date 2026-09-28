import type { Prisma, Role } from "@/generated/prisma/client";

export type InboxUser = { id: string; role: Role };

/**
 * Who may see which WhatsApp conversations. Intentionally NOT getVisibleUserIds: by product decision
 * Managers get the unified all-numbers inbox (unlike the rest of the CRM, where a Manager is
 * team-scoped). The access boundary is always Client.assignedToId, so reassigning a lead moves
 * access on the very next query — there is no separate per-conversation ACL to keep in sync.
 *
 * assigneeIds: null = every assignee (including unassigned clients); array = only those assignees.
 * Returns null when the role has no inbox access at all.
 */
export type InboxScope = { userId: string; role: Role; assigneeIds: string[] | null };

export function getInboxScope(user: InboxUser): InboxScope | null {
  if (user.role === "ADMIN" || user.role === "MANAGER") return { userId: user.id, role: user.role, assigneeIds: null };
  if (user.role === "RM") return { userId: user.id, role: user.role, assigneeIds: [user.id] };
  return null;
}

export function clientScopeWhere(scope: InboxScope): Prisma.ClientWhereInput {
  return {
    isDeleted: false,
    mergedIntoId: null,
    ...(scope.assigneeIds ? { assignedToId: { in: scope.assigneeIds } } : {}),
  };
}

/** Reply permission: ADMIN, or the RM the client is assigned to. Managers are view-only. */
export function canReplyTo(user: InboxUser, client: { assignedToId: string | null }): boolean {
  if (user.role === "ADMIN") return true;
  return user.role === "RM" && client.assignedToId === user.id;
}
