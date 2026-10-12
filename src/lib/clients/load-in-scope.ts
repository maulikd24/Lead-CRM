import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { canViewClient } from "@/lib/clients/access";

/** Roles that work clients day to day: the pipeline board and the client quick view. */
export const DESK_ROLES = ["ADMIN", "MANAGER", "RM"] as const;

/**
 * Loads a client for a server action, only if the caller could open its page (the client page's own rule). Anything else —
 * missing, archived, out of scope — is the same "Client not found", so the response never says which.
 */
export async function loadClientInScope<T extends object>(clientId: string, include: T) {
  const session = await requireRole([...DESK_ROLES]);
  const [client, visibleUserIds] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, include: { ...include, currentStage: true } }),
    getVisibleUserIds(session.user.id, session.user.role),
  ]);
  if (!client || client.isDeleted || !canViewClient(session.user.role, visibleUserIds, client)) throw new Error("Client not found");
  return { session, client };
}
