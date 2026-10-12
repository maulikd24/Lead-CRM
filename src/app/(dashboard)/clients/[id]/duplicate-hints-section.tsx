import { prisma } from "@/lib/db/prisma";
import { DUPLICATE_REVIEW_NOTIFICATION } from "@/lib/clients/ask-manager-wiring";
import { buildDuplicateHints, type HintRow } from "@/lib/clients/duplicate-hints";
import { mergeReviewEnabled } from "@/lib/identity/merge-review/flag";
import { DuplicateHintsCard } from "./duplicate-hints-card";

/**
 * Server wrapper for the customer page: nothing unless the duplicate-review flag is on, the viewer is an RM and the customer is
 * theirs. Managers and admins have the review queue instead.
 */
export async function DuplicateHintsSection({ clientId, actor, assignedToId }: { clientId: string; actor: { id: string; role: string }; assignedToId: string | null }) {
  if (!mergeReviewEnabled() || actor.role !== "RM" || assignedToId !== actor.id) return null;
  const open = await prisma.mergeSuggestion.findMany({
    where: { status: "OPEN", OR: [{ clientAId: clientId }, { clientBId: clientId }] },
    orderBy: { score: "desc" },
    take: 10,
    select: {
      id: true, clientAId: true,
      clientA: { select: { id: true, name: true, clientCode: true, assignedToId: true, isDeleted: true, mergedIntoId: true } },
      clientB: { select: { id: true, name: true, clientCode: true, assignedToId: true, isDeleted: true, mergedIntoId: true } },
    },
  });
  if (open.length === 0) return null;
  const asked = await prisma.notification.findMany({
    where: { type: DUPLICATE_REVIEW_NOTIFICATION, readAt: null, payload: { path: ["requestedById"], equals: actor.id } },
    select: { payload: true },
    take: 50,
  });
  const askedIds = new Set(asked.map((n) => (n.payload as { suggestionId?: unknown }).suggestionId).filter((v): v is string => typeof v === "string"));
  const rows: HintRow[] = open.map((s) => ({ suggestionId: s.id, partner: s.clientAId === clientId ? s.clientB : s.clientA, requested: askedIds.has(s.id) }));
  return <DuplicateHintsCard hints={buildDuplicateHints(actor.id, rows)} />;
}
