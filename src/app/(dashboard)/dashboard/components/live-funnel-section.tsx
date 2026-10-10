import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { getFunnelTotals, getLifecycleCounts } from "@/lib/intelligence/management";
import { liveScope } from "@/lib/dashboard/live-counts";
import { firstName } from "@/lib/dashboard/live-funnel";
import type { Role } from "@/generated/prisma/client";
import { LazyFundedCelebration as FundedCelebration, LazyLiveFunnel } from "./lazy-parts";

/** Server half: loads funnel totals with the existing management queries, scoped like the rest of the dashboard. */
export async function LiveFunnelSection({ role, userId, visibleUserIds, className, part = "all" }: { role: Role; userId: string; visibleUserIds: string[] | null; className?: string; part?: "all" | "funnel" | "celebration" }) {
  // The funnel uses managementScope (a Manager also sees unassigned leads), whereas the KPI tiles below use the
  // dashboard clientFilter (assigned clients only), so the two can legitimately differ for managers.
  const scope = liveScope(visibleUserIds, role);
  // The Today home shows the funnel in one tab and the celebration whichever tab is open, so each half loads only what it needs.
  const [totals, lifecycle, funded] = await Promise.all([
    part === "celebration" ? null : getFunnelTotals(scope),
    part === "celebration" ? null : getLifecycleCounts(scope),
    part === "funnel" ? null : latestFunded(scope),
  ]);
  const scopeLabel = role === "RM" ? "Your customers" : role === "MANAGER" ? "Your team" : "Everyone";
  return (
    <>
      {totals && lifecycle && <LazyLiveFunnel initial={totals} lifecycle={lifecycle} scopeLabel={scopeLabel} className={className} />}
      {part !== "funnel" && (
        <FundedCelebration
          userId={userId}
          latest={funded ? { id: funded.clientId, firstName: firstName(funded.name), atIso: funded.at.toISOString() } : null}
        />
      )}
    </>
  );
}

/** Most recent funding, by when it happened: a funding record's funding date or a successful FUNDS_IN payment (the same two signals management.ts counts as funded). */
async function latestFunded(scope: Prisma.ClientWhereInput) {
  const [record, payment] = await Promise.all([
    prisma.fundingRecord.findFirst({
      where: { status: { in: ["PARTIALLY_FUNDED", "FULLY_FUNDED"] }, fundingDate: { not: null }, client: scope },
      orderBy: { fundingDate: "desc" },
      select: { clientId: true, fundingDate: true, client: { select: { name: true } } },
    }),
    prisma.clientPayment.findFirst({
      where: { paymentType: "FUNDS_IN", status: "SUCCESS", client: scope },
      orderBy: { paidAt: "desc" },
      select: { clientId: true, paidAt: true, client: { select: { name: true } } },
    }),
  ]);
  const candidates = [
    record?.fundingDate ? { clientId: record.clientId, name: record.client.name, at: record.fundingDate } : null,
    payment ? { clientId: payment.clientId, name: payment.client.name, at: payment.paidAt } : null,
  ].filter((c): c is { clientId: string; name: string; at: Date } => c !== null);
  return candidates.sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;
}
