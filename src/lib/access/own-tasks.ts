import type { Role } from "@/generated/prisma/client";

/** Roles that work only on tasks assigned to themselves, whatever the usual visibility rule gives. A marketing hire keeps a task list but sees no customer through it. */
const OWN_TASKS_ONLY: readonly string[] = ["MARKETING"];

export const ownTasksOnly = (role: Role | string | null | undefined): boolean => !!role && OWN_TASKS_ONLY.includes(role);

/** The Prisma `where` for the task list: own tasks for an own-tasks role, otherwise the team/assignee visibility rule (undefined = no restriction). */
export function taskScopeFor(role: Role | string, userId: string, visibleUserIds: string[] | null): { assignedToId: string | { in: string[] } } | undefined {
  if (ownTasksOnly(role)) return { assignedToId: userId };
  return visibleUserIds ? { assignedToId: { in: visibleUserIds } } : undefined;
}
