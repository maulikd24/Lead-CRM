import { prisma } from "@/lib/db/prisma";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { rateLimit } from "@/lib/security/rate-limit";
import { mergeClientRecords, MergeBlockedError } from "@/lib/clients/merge";
import type { DecideDeps, RevealDeps } from "./decide";

/** Merge is irreversible, so it gets a tighter limit than dismiss. Per reviewer, per minute. */
const LIMITS = { merge: 10, dismiss: 40, reveal: 60 } as const;
const LIVE = { isDeleted: false, mergedIntoId: null } as const;

export function decideDeps(): DecideDeps {
  return {
    visibleUserIds: (actor) => getVisibleUserIds(actor.id, actor.role),
    loadSuggestion: (id) => prisma.mergeSuggestion.findUnique({ where: { id }, select: { id: true, status: true, clientAId: true, clientBId: true } }),
    loadClientScopes: (ids) => prisma.client.findMany({ where: { id: { in: ids }, ...LIVE }, select: { id: true, assignedToId: true } }),
    allowRate: async (actorId, kind) => (await rateLimit(`merge-review:${kind}`, actorId, { limit: LIMITS[kind], windowSeconds: 60 })).allowed,
    merge: async ({ suggestionId, survivorId, duplicateId, actorId }) =>
      prisma.$transaction(
        async (tx) => {
          const now = new Date();
          // Compare-and-set: only the first reviewer to reach this row wins; a second one updates nothing and is told so.
          const claimed = await tx.mergeSuggestion.updateMany({ where: { id: suggestionId, status: "OPEN" }, data: { status: "MERGED", decidedAt: now } });
          if (claimed.count !== 1) throw new MergeBlockedError("Someone has already decided this suggestion.");
          const summary = await mergeClientRecords(tx, survivorId, duplicateId, actorId, { enforcePanGuard: true });
          // Other open suggestions about the archived customer can no longer be acted on; close them so they leave every queue.
          const superseded = await tx.mergeSuggestion.updateMany({
            where: { status: "OPEN", id: { not: suggestionId }, OR: [{ clientAId: duplicateId }, { clientBId: duplicateId }] },
            data: { status: "DISMISSED", decidedAt: now },
          });
          await tx.auditLog.create({
            data: {
              userId: actorId,
              entity: "MergeSuggestion",
              entityId: suggestionId,
              action: "merge_suggestion_merged",
              newValue: { survivorId, duplicateId, supersededSuggestions: superseded.count },
            },
          });
          return summary;
        },
        { timeout: 20_000 },
      ),
    dismiss: ({ suggestionId, actorId, reason }) =>
      prisma.$transaction(async (tx) => {
        const claimed = await tx.mergeSuggestion.updateMany({ where: { id: suggestionId, status: "OPEN" }, data: { status: "DISMISSED", decidedAt: new Date() } });
        if (claimed.count !== 1) return false;
        await tx.auditLog.create({
          data: { userId: actorId, entity: "MergeSuggestion", entityId: suggestionId, action: "merge_suggestion_dismissed", reason },
        });
        return true;
      }),
  };
}

export function revealDeps(): RevealDeps {
  const base = decideDeps();
  return {
    visibleUserIds: base.visibleUserIds,
    loadSuggestion: base.loadSuggestion,
    loadClientScopes: base.loadClientScopes,
    allowRate: base.allowRate,
    logAccess: async ({ userId, clientId, field }) => {
      await prisma.dataAccessLog.create({ data: { userId, entity: "Client", entityId: clientId, fieldName: field, reason: "duplicate review" } });
    },
    readField: async (clientId, field) => {
      const c = await prisma.client.findUnique({ where: { id: clientId }, select: { mobile: true, email: true, pan: true } });
      return c?.[field] ?? null;
    },
  };
}
