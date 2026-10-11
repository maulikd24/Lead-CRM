import { can } from "@/lib/access/policy";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { canOpen360 } from "@/lib/clients/access";
import { prisma } from "@/lib/db/prisma";

/**
 * Who may read or change a customer's memory. Two layers, both required (default deny):
 *  1. the role holds the area in the permission registry (RM and MANAGER; ADMIN everywhere; MARKETING and every other role never), and
 *  2. the customer is in the person's record scope: an RM their own, a manager their team's, an admin all. A merged customer is not
 *     found for anyone and an archived one is for ADMIN only (the same rule as Customer 360).
 * Pure so every role can be tested without a database; `authoriseMemory` is the loader-side wrapper.
 */
type ClientScope = { assignedToId: string | null; isDeleted: boolean; mergedIntoId: string | null };

export function canSeeMemory(role: string, visibleUserIds: string[] | null, client: ClientScope): boolean {
  if (!can(role, "customer-memory", "view")) return false;
  return canOpen360(role, visibleUserIds, client);
}

export function canManageMemory(role: string, visibleUserIds: string[] | null, client: ClientScope): boolean {
  if (!can(role, "customer-memory", "manage")) return false;
  return canOpen360(role, visibleUserIds, client);
}

export type Viewer = { userId: string; role: string };

export type Authorised = { ok: true; canManage: boolean; client: { id: string; assignedToId: string | null } } | { ok: false };

/** Loads the customer's scope fields and decides. `ok: false` means "answer not found": it never says whether the customer exists. */
export async function authoriseMemory(viewer: Viewer, clientId: string): Promise<Authorised> {
  if (!can(viewer.role, "customer-memory", "view")) return { ok: false };
  const [client, visible] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { id: true, assignedToId: true, isDeleted: true, mergedIntoId: true } }),
    getVisibleUserIds(viewer.userId, viewer.role as Parameters<typeof getVisibleUserIds>[1]),
  ]);
  if (!client || !canSeeMemory(viewer.role, visible, client)) return { ok: false };
  return { ok: true, canManage: canManageMemory(viewer.role, visible, client), client: { id: client.id, assignedToId: client.assignedToId } };
}
