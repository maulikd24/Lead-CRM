import { prisma } from "@/lib/db/prisma";
import { getFunnelTotals, getLifecycleCounts } from "@/lib/intelligence/management";
import { liveScope } from "@/lib/dashboard/live-counts";
import { firstName } from "@/lib/dashboard/live-funnel";
import type { Role } from "@/generated/prisma/client";
import { LiveFunnel } from "./live-funnel";
import { FundedCelebration } from "./funded-celebration";

/** Server half: loads funnel totals with the existing management queries, scoped like the rest of the dashboard. */
export async function LiveFunnelSection({ role, userId, visibleUserIds, className }: { role: Role; userId: string; visibleUserIds: string[] | null; className?: string }) {
  const scope = liveScope(visibleUserIds, role);
  const [totals, lifecycle, latestFunded] = await Promise.all([
    getFunnelTotals(scope),
    getLifecycleCounts(scope),
    prisma.fundingRecord.findFirst({
      where: { status: { in: ["PARTIALLY_FUNDED", "FULLY_FUNDED"] }, client: scope },
      orderBy: { updatedAt: "desc" },
      select: { clientId: true, updatedAt: true, client: { select: { name: true } } },
    }),
  ]);
  const scopeLabel = role === "RM" ? "Your customers" : role === "MANAGER" ? "Your team" : "Everyone";
  return (
    <>
      <LiveFunnel initial={totals} lifecycle={lifecycle} scopeLabel={scopeLabel} className={className} />
      <FundedCelebration
        userId={userId}
        latest={latestFunded ? { id: latestFunded.clientId, firstName: firstName(latestFunded.client.name), atIso: latestFunded.updatedAt.toISOString() } : null}
      />
    </>
  );
}
