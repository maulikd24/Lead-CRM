import { prisma } from "@/lib/db/prisma";
import { getFunnelTotals, managementScope } from "@/lib/intelligence/management";
import type { Role } from "@/generated/prisma/client";
import type { FunnelTotals } from "./live-funnel";

export type LiveCounts = { totals: FunnelTotals; newToday: number; newestLeadAt: string | null; at: string };

/** Same visibility rules as the dashboard: admins see everyone, managers their team plus unassigned, RMs their own. */
export function liveScope(visibleUserIds: string[] | null, role: Role) {
  return managementScope(visibleUserIds, role === "MANAGER");
}

/** Counts only: no names, no contact details. */
export async function getLiveCounts(visibleUserIds: string[] | null, role: Role, now = new Date()): Promise<LiveCounts> {
  const scope = liveScope(visibleUserIds, role);
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const [totals, newToday, newest] = await Promise.all([
    getFunnelTotals(scope),
    prisma.client.count({ where: { AND: [scope, { createdAt: { gte: startOfDay } }] } }),
    prisma.client.findFirst({ where: scope, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  return { totals, newToday, newestLeadAt: newest?.createdAt.toISOString() ?? null, at: now.toISOString() };
}
