import { prisma } from "@/lib/db/prisma";
import { rateLimit } from "@/lib/security/rate-limit";
import type { AskDeps } from "./ask-manager";

export const DUPLICATE_REVIEW_NOTIFICATION = "duplicate_review_requested";

export function askManagerDeps(): AskDeps {
  return {
    allowRate: async (actorId) => (await rateLimit("ask-manager-duplicate", actorId, { limit: 10, windowSeconds: 60 })).allowed,
    loadSuggestion: (id) => prisma.mergeSuggestion.findUnique({ where: { id }, select: { id: true, status: true, clientAId: true, clientBId: true } }),
    loadClients: (ids) => prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, clientCode: true, assignedToId: true, isDeleted: true, mergedIntoId: true } }),
    recipientsFor: async (actorId) => {
      const me = await prisma.user.findUnique({ where: { id: actorId }, select: { managerId: true } });
      if (me?.managerId) {
        const mgr = await prisma.user.findFirst({ where: { id: me.managerId, isActive: true }, select: { id: true } });
        if (mgr) return [mgr.id];
      }
      const managers = await prisma.user.findMany({ where: { role: "MANAGER", isActive: true }, select: { id: true } });
      if (managers.length) return managers.map((m) => m.id);
      return (await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } })).map((a) => a.id);
    },
    alreadyAsked: async (actorId, suggestionId) =>
      !!(await prisma.notification.findFirst({
        where: { type: DUPLICATE_REVIEW_NOTIFICATION, readAt: null, AND: [{ payload: { path: ["suggestionId"], equals: suggestionId } }, { payload: { path: ["requestedById"], equals: actorId } }] },
        select: { id: true },
      })),
    notify: async (userIds, payload) => {
      await prisma.notification.createMany({ data: userIds.map((userId) => ({ userId, type: DUPLICATE_REVIEW_NOTIFICATION, payload })) });
    },
  };
}
