import { prisma } from "@/lib/db/prisma";
import { netRevenue } from "@/lib/revenue/net-revenue";

/** Roles that may see revenue figures — the same as the Earnings page. */
export const REVENUE_VIEW_ROLES = ["ADMIN", "FINANCE"] as const;

export function canViewRevenue(role: string): boolean {
  return (REVENUE_VIEW_ROLES as readonly string[]).includes(role);
}

/**
 * Lifetime revenue earned from each client (brokerage and advisory fees, net of reversals — the same rule as the
 * marketing report's revenue), for one page of the clients list. Clients with none are left out of the map.
 */
export async function lifetimeRevenueByClient(clientIds: string[]): Promise<Map<string, number>> {
  if (clientIds.length === 0) return new Map();
  const events = await prisma.revenueEvent.findMany({
    where: { clientId: { in: clientIds } },
    select: { id: true, clientId: true, revenueType: true, grossRevenueAmount: true, reversesEventId: true, reverses: { select: { revenueType: true } } },
  });
  const byClient = new Map<string, typeof events>();
  for (const e of events) {
    if (!e.clientId) continue;
    byClient.set(e.clientId, [...(byClient.get(e.clientId) ?? []), e]);
  }
  const result = new Map<string, number>();
  for (const [clientId, rows] of byClient) {
    const total = netRevenue(
      rows.map((e) => ({ id: e.id, revenueType: e.revenueType, amount: Number(e.grossRevenueAmount), reversesEventId: e.reversesEventId, reversedType: e.reverses?.revenueType ?? null })),
    );
    if (total > 0) result.set(clientId, total);
  }
  return result;
}
