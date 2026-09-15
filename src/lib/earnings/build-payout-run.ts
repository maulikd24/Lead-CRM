import { prisma } from "@/lib/db/prisma";

export type AccrualForPayout = { id: string; partnerProfileId: string; accrualAmount: number };
export type PayoutGroup = { partnerProfileId: string; totalAccrualAmount: number; accrualIds: string[] };

/** Pure grouping — no Prisma calls. Sums CommissionAccrual amounts per partner and keeps the
 * accrual ids that fed each sum, so the caller can create one PayoutLine per accrual. */
export function groupAccrualsForPayout(accruals: AccrualForPayout[]): PayoutGroup[] {
  const byPartner = new Map<string, PayoutGroup>();
  for (const accrual of accruals) {
    const existing = byPartner.get(accrual.partnerProfileId);
    if (existing) {
      existing.totalAccrualAmount += accrual.accrualAmount;
      existing.accrualIds.push(accrual.id);
    } else {
      byPartner.set(accrual.partnerProfileId, {
        partnerProfileId: accrual.partnerProfileId,
        totalAccrualAmount: accrual.accrualAmount,
        accrualIds: [accrual.id],
      });
    }
  }
  return Array.from(byPartner.values());
}

/**
 * (Re)builds a DRAFT PayoutRun's Payout/PayoutLine rows from every ACCRUED CommissionAccrual whose
 * accrualDate falls inside the run's period. Safe to call repeatedly on a still-DRAFT run — it
 * deletes and recreates that run's own Payout/PayoutLine rows each time (nothing external depends
 * on a DRAFT run's lines yet), so Finance can adjust the period and regenerate before submitting
 * for approval. Throws if the run isn't DRAFT — once submitted, its lines are frozen.
 */
export async function buildPayoutRun(payoutRunId: string): Promise<{ payoutCount: number; totalAmount: number }> {
  const run = await prisma.payoutRun.findUniqueOrThrow({ where: { id: payoutRunId } });
  if (run.status !== "DRAFT") throw new Error(`Cannot (re)build a PayoutRun that is ${run.status}, not DRAFT`);

  const accruals = await prisma.commissionAccrual.findMany({
    where: { status: "ACCRUED", accrualDate: { gte: run.periodStart, lt: run.periodEnd } },
    select: { id: true, partnerProfileId: true, accrualAmount: true },
  });
  const groups = groupAccrualsForPayout(accruals.map((a) => ({ ...a, accrualAmount: Number(a.accrualAmount) })));

  await prisma.$transaction(async (tx) => {
    const existingPayouts = await tx.payout.findMany({ where: { payoutRunId }, select: { id: true } });
    if (existingPayouts.length > 0) {
      const existingIds = existingPayouts.map((p) => p.id);
      await tx.payoutLine.deleteMany({ where: { payoutId: { in: existingIds } } });
      await tx.commissionAdjustment.deleteMany({ where: { payoutId: { in: existingIds } } });
      await tx.payout.deleteMany({ where: { id: { in: existingIds } } });
    }

    for (const group of groups) {
      const payout = await tx.payout.create({
        data: {
          payoutRunId,
          partnerProfileId: group.partnerProfileId,
          totalAccrualAmount: group.totalAccrualAmount,
          netPayableAmount: group.totalAccrualAmount,
        },
      });
      await tx.payoutLine.createMany({
        data: group.accrualIds.map((commissionAccrualId) => ({
          payoutId: payout.id,
          commissionAccrualId,
          amount: accruals.find((a) => a.id === commissionAccrualId)!.accrualAmount,
        })),
      });
    }
  });

  return { payoutCount: groups.length, totalAmount: groups.reduce((sum, g) => sum + g.totalAccrualAmount, 0) };
}
