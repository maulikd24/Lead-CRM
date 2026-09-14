import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/utils/format";
import { latestPositionPerHolding } from "@/lib/households/latest-positions";
import { NewHouseholdDialog } from "./new-household-dialog";
import { PortfolioImportDialog } from "./portfolio-import-dialog";
import { bulkImportPositionsAction, bulkImportTransactionsAction } from "./import-actions";

const POSITION_COLUMNS = ["clientCode", "accountNumber", "accountType", "productCode", "productName", "productCategory", "quantity", "avgCost", "currentValue", "asOfDate", "externalRef"];
const TRANSACTION_COLUMNS = ["clientCode", "accountNumber", "accountType", "productCode", "productName", "productCategory", "transactionType", "transactionDate", "quantity", "price", "grossAmount", "netAmount", "brokerageAmount", "externalRef"];

export default async function HouseholdsPage() {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);

  const households = await prisma.household.findMany({
    where: visibleUserIds ? { members: { some: { client: { assignedToId: { in: visibleUserIds } } } } } : {},
    include: {
      members: { include: { client: { select: { name: true, assignedToId: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  const aumByHousehold = new Map<string, number>();
  if (households.length > 0) {
    const clientIds = households.flatMap((h) => h.members.map((m) => m.clientId));
    const allPositions = await prisma.position.findMany({
      where: { tradingAccount: { clientId: { in: clientIds } } },
      select: { currentValue: true, productId: true, tradingAccountId: true, asOfDate: true, tradingAccount: { select: { clientId: true } } },
    });
    // Dedupe to each holding's latest snapshot before summing — otherwise AUM inflates every time
    // a new batch/CSV snapshot lands, since multiple asOfDate rows can exist per holding.
    const latest = latestPositionPerHolding(allPositions);
    const aumByClient = new Map<string, number>();
    for (const p of latest) {
      const value = p.currentValue ? Number(p.currentValue) : 0;
      aumByClient.set(p.tradingAccount.clientId, (aumByClient.get(p.tradingAccount.clientId) ?? 0) + value);
    }
    for (const h of households) {
      const total = h.members.reduce((sum, m) => sum + (aumByClient.get(m.clientId) ?? 0), 0);
      aumByHousehold.set(h.id, total);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Households"
        description={`${households.length} household${households.length === 1 ? "" : "s"}.`}
        actions={
          <>
            <PortfolioImportDialog
              label="Import Holdings"
              title="Import Holdings CSV"
              description="Upserts Position rows by account + product + as-of date — safe to re-run. Missing accounts/products are created automatically."
              columns={POSITION_COLUMNS}
              templateFilename="holdings-import-template.csv"
              action={bulkImportPositionsAction}
            />
            <PortfolioImportDialog
              label="Import Transactions"
              title="Import Transactions CSV"
              description="Upserts Transaction rows by externalRef — safe to re-run. Missing accounts/products are created automatically."
              columns={TRANSACTION_COLUMNS}
              templateFilename="transactions-import-template.csv"
              action={bulkImportTransactionsAction}
            />
            <NewHouseholdDialog />
          </>
        }
      />
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Household</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Total AUM</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody striped>
              {households.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>
                    <Link href={`/households/${h.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                      {h.name}
                    </Link>
                    <p className="font-mono text-xs text-muted-foreground">{h.householdCode}</p>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {h.members.map((m) => m.client.name).join(", ") || "No members yet"}
                  </TableCell>
                  <TableCell className="text-sm">₹{formatNumber(aumByHousehold.get(h.id) ?? 0)}</TableCell>
                </TableRow>
              ))}
              {households.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                    No households yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
