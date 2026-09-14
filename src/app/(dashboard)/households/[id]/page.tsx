import { notFound } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { formatNumber } from "@/lib/utils/format";
import { latestPositionPerHolding } from "@/lib/households/latest-positions";
import { HouseholdDetailTabs } from "./household-detail-tabs";

export default async function HouseholdDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const { id } = await params;
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);

  const household = await prisma.household.findUnique({
    where: { id },
    include: {
      members: {
        include: { client: { select: { id: true, name: true, clientCode: true, assignedToId: true } } },
        orderBy: { isPrimary: "desc" },
      },
    },
  });
  if (!household) notFound();

  const memberClientIds = household.members.map((m) => m.client.id);
  if (
    visibleUserIds &&
    !household.members.some((m) => m.client.assignedToId && visibleUserIds.includes(m.client.assignedToId))
  ) {
    // Empty household (no members yet) is visible to any Admin/Manager who can create one;
    // a non-empty household is only visible if at least one member is in the caller's scope.
    if (memberClientIds.length > 0) notFound();
  }

  const tradingAccounts = memberClientIds.length
    ? await prisma.tradingAccount.findMany({
        where: { clientId: { in: memberClientIds } },
        include: {
          positions: { include: { product: true }, orderBy: { asOfDate: "desc" } },
          transactions: { include: { product: true }, orderBy: { transactionDate: "desc" }, take: 100 },
        },
      })
    : [];

  // Keep only each holding's latest as-of-date snapshot, mirroring how a real holdings statement
  // reads (not every historical batch-feed snapshot at once) — shared with the Households list
  // page's AUM rollup so the two can never disagree.
  const latestPositions = tradingAccounts.flatMap((account) =>
    latestPositionPerHolding(account.positions).map((position) => ({ position, account })),
  );

  const totalAum = latestPositions.reduce((sum, { position }) => sum + Number(position.currentValue ?? 0), 0);
  const transactions = tradingAccounts.flatMap((account) => account.transactions.map((t) => ({ transaction: t, account })));

  // Prisma's Decimal fields aren't plain-serializable across the Server->Client Component
  // boundary — convert to plain numbers before passing down (same convention as dealer-desk and
  // clients/[id]/page.tsx).
  const serializedPositions = latestPositions.map(({ position, account }) => ({
    position: { ...position, quantity: Number(position.quantity), avgCost: position.avgCost ? Number(position.avgCost) : null, currentValue: position.currentValue ? Number(position.currentValue) : null },
    account: { id: account.id, accountNumber: account.accountNumber, accountType: account.accountType },
  }));
  const serializedTransactions = transactions.map(({ transaction, account }) => ({
    transaction: {
      ...transaction,
      quantity: transaction.quantity ? Number(transaction.quantity) : null,
      price: transaction.price ? Number(transaction.price) : null,
      grossAmount: Number(transaction.grossAmount),
      netAmount: transaction.netAmount ? Number(transaction.netAmount) : null,
      brokerageAmount: transaction.brokerageAmount ? Number(transaction.brokerageAmount) : null,
    },
    account: { id: account.id, accountNumber: account.accountNumber, accountType: account.accountType },
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={household.name} description={household.householdCode} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Members" value={household.members.length} />
        <StatCard label="Trading Accounts" value={tradingAccounts.length} />
        <StatCard label="Total AUM" value={`₹${formatNumber(totalAum)}`} />
      </div>

      <HouseholdDetailTabs
        household={household}
        accountCount={tradingAccounts.length}
        positions={serializedPositions}
        transactions={serializedTransactions}
      />
    </div>
  );
}
