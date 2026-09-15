import { notFound } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { formatDate, formatNumber } from "@/lib/utils/format";
import { PayoutTable } from "./payout-table";
import { RunActionsBar } from "./run-actions-bar";

export default async function PayoutRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "FINANCE"]);
  const { id } = await params;

  const run = await prisma.payoutRun.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      payouts: {
        include: {
          partnerProfile: { include: { user: { select: { name: true } } } },
          lines: {
            include: {
              commissionAccrual: {
                include: {
                  revenueEvent: { include: { transaction: true } },
                },
              },
            },
          },
          adjustments: { orderBy: { createdAt: "desc" } },
        },
      },
    },
  });
  if (!run) notFound();

  const serializedPayouts = run.payouts.map((payout) => ({
    id: payout.id,
    partnerProfileId: payout.partnerProfileId,
    partnerName: payout.partnerProfile.user.name,
    totalAccrualAmount: Number(payout.totalAccrualAmount),
    adjustmentAmount: Number(payout.adjustmentAmount),
    netPayableAmount: Number(payout.netPayableAmount),
    status: payout.status,
    externalPayoutRef: payout.externalPayoutRef,
    lines: payout.lines.map((line) => ({
      id: line.id,
      amount: Number(line.amount),
      commissionAccrual: {
        accrualAmount: Number(line.commissionAccrual.accrualAmount),
        accrualDate: line.commissionAccrual.accrualDate,
        revenueEvent: {
          revenueType: line.commissionAccrual.revenueEvent.revenueType,
          grossRevenueAmount: Number(line.commissionAccrual.revenueEvent.grossRevenueAmount),
          eventDate: line.commissionAccrual.revenueEvent.eventDate,
          sourceSystem: line.commissionAccrual.revenueEvent.sourceSystem,
          transaction: line.commissionAccrual.revenueEvent.transaction
            ? {
                transactionType: line.commissionAccrual.revenueEvent.transaction.transactionType,
                transactionDate: line.commissionAccrual.revenueEvent.transaction.transactionDate,
                grossAmount: Number(line.commissionAccrual.revenueEvent.transaction.grossAmount),
                externalRef: line.commissionAccrual.revenueEvent.transaction.externalRef,
              }
            : null,
        },
      },
    })),
    adjustments: payout.adjustments.map((a) => ({ id: a.id, amount: Number(a.amount), reason: a.reason, createdAt: a.createdAt })),
  }));

  const totalPayable = serializedPayouts.reduce((sum, p) => sum + p.netPayableAmount, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${formatDate(run.periodStart)} – ${formatDate(run.periodEnd)}`}
        description={`Created by ${run.createdBy.name}${run.approvedBy ? ` · Approved by ${run.approvedBy.name}` : ""}`}
        actions={<RunActionsBar payoutRunId={run.id} status={run.status} canFinalize={session.user.role === "ADMIN"} />}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Status" value={run.status.replace(/_/g, " ")} />
        <StatCard label="Partners" value={serializedPayouts.length} />
        <StatCard label="Total Payable" value={`₹${formatNumber(totalPayable)}`} />
      </div>

      <PayoutTable payouts={serializedPayouts} runStatus={run.status} />
    </div>
  );
}
