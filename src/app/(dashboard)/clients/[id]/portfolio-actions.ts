"use server";

import { prisma } from "@/lib/db/prisma";
import { requireAccess } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { canViewClient } from "@/lib/clients/access";
import { loadPortfolioSummary, type PortfolioSummary } from "@/lib/clients/portfolio-aggregate";

/**
 * Loaded on demand by the portfolio card, never with the page. Returns aggregates only (name, total AUM, asset-class mix, last
 * trading date): holdings and trades are not part of the return type, for any role.
 */
export async function getPortfolioSummaryAction(clientId: string): Promise<PortfolioSummary> {
  const session = await requireAccess("clients");
  const [client, visibleUserIds] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, assignedToId: true } }),
    getVisibleUserIds(session.user.id, session.user.role),
  ]);
  if (!client || !canViewClient(session.user.role, visibleUserIds, client)) throw new Error("Client not found");
  return loadPortfolioSummary(client.id, client.name);
}
