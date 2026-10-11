import Link from "next/link";

import { requireAccess } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/utils/format";
import { loadHouseholdList } from "@/lib/households/privacy/load";
import { NewHouseholdDialog } from "./new-household-dialog";
import { PortfolioImportDialog } from "./portfolio-import-dialog";
import { bulkImportPositionsAction, bulkImportTransactionsAction, bulkImportPaymentsAction } from "./import-actions";

const POSITION_COLUMNS = ["clientCode", "accountNumber", "accountType", "productCode", "productName", "productCategory", "quantity", "avgCost", "currentValue", "asOfDate", "externalRef"];
const TRANSACTION_COLUMNS = ["clientCode", "accountNumber", "accountType", "productCode", "productName", "productCategory", "transactionType", "transactionDate", "quantity", "price", "grossAmount", "netAmount", "brokerageAmount", "externalRef"];

const PAYMENT_COLUMNS = ["clientCode", "accountNumber", "paymentType", "amount", "paidAt", "mode", "referenceNumber", "status", "externalRef"];

export default async function HouseholdsPage() {
  const session = await requireAccess("households");
  // Privacy walls: names of members outside the viewer's scope and household-wide AUM are not on this list (see lib/households/privacy/list.ts).
  const households = await loadHouseholdList({ userId: session.user.id, role: session.user.role });

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
            <PortfolioImportDialog
              label="Import Payments"
              title="Import Payments CSV"
              description="Upserts payments by externalRef — safe to re-run, and a corrected row updates the existing payment. paymentType: FUNDS_IN, FUNDS_OUT, FEE or OTHER; status: SUCCESS, PENDING or FAILED; accountNumber is optional."
              columns={PAYMENT_COLUMNS}
              templateFilename="payments-import-template.csv"
              action={bulkImportPaymentsAction}
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
                    {h.memberNames.join(", ") || "No members yet"}
                    {h.hiddenMembers > 0 && <span className="block text-xs">+{h.hiddenMembers} other member{h.hiddenMembers === 1 ? "" : "s"} (another relationship manager)</span>}
                  </TableCell>
                  <TableCell className="text-sm">
                    ₹{formatNumber(h.aum)}
                    {h.partial && <span className="block text-xs text-muted-foreground">Your members only</span>}
                  </TableCell>
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
