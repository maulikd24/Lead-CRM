"use server";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";

export type PaletteClientResult = { id: string; name: string; clientCode: string; mobile: string };

export async function searchClientsForPalette(query: string): Promise<PaletteClientResult[]> {
  const session = await requireUser();
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);

  const clients = await prisma.client.findMany({
    where: {
      ...(visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {}),
      OR: [
        { name: { contains: trimmed, mode: "insensitive" } },
        { clientCode: { contains: trimmed, mode: "insensitive" } },
        { mobile: { contains: trimmed } },
      ],
    },
    select: { id: true, name: true, clientCode: true, mobile: true },
    take: 8,
  });

  return clients;
}
