import { getFunnelTotals, getLifecycleCounts } from "@/lib/intelligence/management";
import { liveScope } from "@/lib/dashboard/live-counts";
import type { Role } from "@/generated/prisma/client";
import { LazyLiveFunnel } from "./lazy-parts";

/** Server half: loads funnel totals with the existing management queries, scoped like the rest of the dashboard. */
export async function LiveFunnelSection({ role, visibleUserIds, className }: { role: Role; userId: string; visibleUserIds: string[] | null; className?: string; part?: "all" | "funnel" }) {
  // The funnel uses managementScope (a Manager also sees unassigned leads), whereas the KPI tiles below use the
  // dashboard clientFilter (assigned clients only), so the two can legitimately differ for managers.
  const scope = liveScope(visibleUserIds, role);
  const [totals, lifecycle] = await Promise.all([getFunnelTotals(scope), getLifecycleCounts(scope)]);
  const scopeLabel = role === "RM" ? "Your customers" : role === "MANAGER" ? "Your team" : "Everyone";
  return <LazyLiveFunnel initial={totals} lifecycle={lifecycle} scopeLabel={scopeLabel} className={className} />;
}
