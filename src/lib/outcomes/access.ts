import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { canOpen360 } from "@/lib/clients/access";
import { prisma } from "@/lib/db/prisma";

import { outcomesEnabled } from "./flag";
import { mayEditGoals } from "./goal-input";

/**
 * The one gate for every outcomes action: the feature flag, a signed-in user, the same visibility rule as opening the
 * customer's 360 page, and (for changes) the edit rule. A customer the user may not open and one that does not exist
 * look the same ("not found"), so ids cannot be probed.
 */
export async function authorizeOutcomes(clientId: string, mode: "view" | "edit") {
  if (!outcomesEnabled()) throw new Error("Not found");
  const session = await requireUser();
  const [client, visibleUserIds] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, assignedToId: true, isDeleted: true, mergedIntoId: true } }),
    getVisibleUserIds(session.user.id, session.user.role),
  ]);
  if (!client || !canOpen360(session.user.role, visibleUserIds, client)) throw new Error("Not found");
  if (mode === "edit" && !mayEditGoals(session.user.role, session.user.id, client.assignedToId)) throw new Error("Only the customer's relationship manager can change this");
  return { session, client };
}
