import { notFound } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireAccess } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { formatNumber } from "@/lib/utils/format";
import { loadPortfolioSummaryForClients } from "@/lib/clients/portfolio-aggregate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PortfolioSummaryView } from "../../clients/[id]/portfolio-summary-view";
import { wallHouseholdMembers } from "@/lib/households/privacy-wall";
import { can } from "@/lib/access/policy";
import { householdIntelligenceEnabled } from "@/lib/memory/flag";
import { HouseholdIntelligence } from "@/components/households/household-intelligence";
import { OverviewPanel } from "./overview-panel";

export default async function HouseholdDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAccess("households");
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

  // Privacy wall, ALWAYS on (not behind HOUSEHOLD_INTELLIGENCE_ENABLED): holdings, transactions and the member list below show only the
  // members this viewer can already open themselves. The flag only adds the intelligence panel, where other members appear as
  // "Another household member", with only the relationship.
  household.members = wallHouseholdMembers(session.user.role, visibleUserIds, household.members);
  const walled = householdIntelligenceEnabled() && can(session.user.role, "household-intelligence", "view");
  const memberClientIds = household.members.map((m) => m.client.id);
  if (
    visibleUserIds &&
    !household.members.some((m) => m.client.assignedToId && visibleUserIds.includes(m.client.assignedToId))
  ) {
    // Empty household (no members yet) is visible to any Admin/Manager who can create one;
    // a non-empty household is only visible if at least one member is in the caller's scope.
    if (memberClientIds.length > 0) notFound();
  }

  // Aggregates only: name, total AUM, asset-class mix and the last trading date. No holding, account number or trade row is loaded or sent, for any role.
  const [accountCount, portfolio] = await Promise.all([
    memberClientIds.length ? prisma.tradingAccount.count({ where: { clientId: { in: memberClientIds } } }) : 0,
    loadPortfolioSummaryForClients(memberClientIds, household.name),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={household.name} description={household.householdCode} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label={visibleUserIds ? "Members you look after" : "Members"} value={household.members.length} />
        <StatCard label="Trading Accounts" value={accountCount} />
        <StatCard label="Total AUM" value={`₹${formatNumber(Math.round(portfolio.totalAum))}`} />
      </div>

      {walled && <HouseholdIntelligence householdId={household.id} viewer={{ userId: session.user.id, role: session.user.role }} />}

      <OverviewPanel household={household} accountCount={accountCount} />

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Portfolio</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <PortfolioSummaryView data={portfolio} />
        </CardContent>
      </Card>
    </div>
  );
}
