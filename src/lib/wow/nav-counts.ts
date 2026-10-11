import { prisma } from "@/lib/db/prisma";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { mergeReviewEnabled } from "@/lib/identity/merge-review/flag";
import { countOpenSuggestions } from "@/lib/identity/merge-review/load";
import { approvalsInboxEnabled } from "@/lib/policy/approvals/canonical/flag";
import { approvalService } from "@/lib/policy/approvals/canonical/wiring";
import { can } from "@/lib/access/policy";
import type { Role } from "@/generated/prisma/client";

const DESK_ROLES: Role[] = ["ADMIN", "MANAGER", "RM"];

/**
 * The small numbers beside sidebar items, scoped exactly like the pages they point at: conversations with an unread customer
 * message (Inbox) and tasks past their due time (Tasks). Roles without those screens cost no queries. A failure here must never
 * break the page, so it returns no counts.
 */
export async function getNavCounts(userId: string, role: Role): Promise<Record<string, number>> {
  const approvals = await approvalsWaiting(userId, role);
  if (!DESK_ROLES.includes(role)) return approvals;
  try {
    const visible = await getVisibleUserIds(userId, role);
    const clientWhere = visible ? { assignedToId: { in: visible }, isDeleted: false } : { isDeleted: false };
    const [unread, overdue, duplicates] = await Promise.all([
      prisma.message.groupBy({ by: ["clientId"], where: { direction: "INBOUND", readAt: null, client: clientWhere } }),
      prisma.task.count({ where: { ...(visible ? { assignedToId: { in: visible } } : {}), status: { in: ["PENDING", "OVERDUE"] }, dueAt: { lt: new Date() }, client: { isDeleted: false } } }),
      mergeReviewEnabled() ? countOpenSuggestions({ id: userId, role }) : Promise.resolve(0),
    ]);
    return { "/inbox": unread.length, "/tasks": overdue, "/clients/duplicates": duplicates, ...approvals };
  } catch {
    return {};
  }
}

/** Approvals waiting for this person (the same list the Approvals inbox opens on), only where the inbox is on and the role may open it. Never throws. */
async function approvalsWaiting(userId: string, role: Role): Promise<Record<string, number>> {
  if (!approvalsInboxEnabled() || !can(role, "approvals", "view")) return {};
  try {
    const awaiting = await approvalService().listFor({ id: userId, role, name: null }, { tab: "awaiting" });
    return awaiting.items.length > 0 ? { "/approvals": awaiting.items.length } : {};
  } catch {
    return {};
  }
}
