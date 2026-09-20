"use server";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";

export type PaletteClientResult = {
  id: string;
  name: string;
  clientCode: string;
  mobile: string | null;
  // Present when this result surfaced via a joint holder's name/mobile rather than the account's
  // own — the palette still navigates to the parent account (there's no standalone holder page).
  matchedHolder?: { name: string; position: string | null };
};

export async function searchClientsForPalette(query: string): Promise<PaletteClientResult[]> {
  const session = await requireUser();
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const assignedToFilter = visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {};

  const [clients, holderMatches] = await Promise.all([
    prisma.client.findMany({
      where: {
        ...assignedToFilter,
        OR: [
          { name: { contains: trimmed, mode: "insensitive" } },
          { clientCode: { contains: trimmed, mode: "insensitive" } },
          { mobile: { contains: trimmed } },
        ],
      },
      select: { id: true, name: true, clientCode: true, mobile: true },
      take: 8,
    }),
    prisma.accountHolder.findMany({
      where: {
        isDeleted: false,
        client: assignedToFilter,
        OR: [
          { name: { contains: trimmed, mode: "insensitive" } },
          { mobile: { contains: trimmed } },
        ],
      },
      select: { name: true, position: true, client: { select: { id: true, name: true, clientCode: true, mobile: true } } },
      take: 8,
    }),
  ]);

  const seenClientIds = new Set(clients.map((c) => c.id));
  const holderResults: PaletteClientResult[] = holderMatches
    .filter((h) => !seenClientIds.has(h.client.id))
    .map((h) => ({ ...h.client, matchedHolder: { name: h.name, position: h.position } }));

  return [...clients, ...holderResults].slice(0, 8);
}
