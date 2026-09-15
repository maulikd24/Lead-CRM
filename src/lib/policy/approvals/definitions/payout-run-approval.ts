import { prisma } from "@/lib/db/prisma";
import { registerApproval } from "../registry";

type PayoutRunApprovalPayload = { payoutRunId: string };

// Reuses the PAYOUT_ADJUSTMENT actionType already reserved in the registry's union — approving a
// payout run is the maker-checker gate on the run itself; CommissionAdjustment (see
// commission-adjustment.ts) is the separate gate on a manual correction within an already-approved
// run's Payout.
registerApproval<PayoutRunApprovalPayload>({
  actionType: "PAYOUT_ADJUSTMENT",
  entity: "PayoutRun",
  canRequest: (actor) => actor.role === "FINANCE" || actor.role === "ADMIN",
  canDecide: (actor) => actor.role === "ADMIN",
  apply: async (payload, ctx) => {
    const run = await prisma.payoutRun.findUniqueOrThrow({ where: { id: payload.payoutRunId } });
    if (run.status !== "PENDING_APPROVAL") return; // already applied — idempotent no-op re-run

    await prisma.$transaction(async (tx) => {
      await tx.payoutRun.update({
        where: { id: run.id },
        data: { status: "APPROVED", approvedById: ctx.decidedById, approvedAt: new Date() },
      });
      const payouts = await tx.payout.findMany({ where: { payoutRunId: run.id }, select: { id: true } });
      await tx.payout.updateMany({ where: { payoutRunId: run.id }, data: { status: "APPROVED" } });
      await tx.commissionAccrual.updateMany({
        where: { payoutLines: { some: { payoutId: { in: payouts.map((p) => p.id) } } } },
        data: { status: "INCLUDED_IN_PAYOUT" },
      });
    });
  },
});
