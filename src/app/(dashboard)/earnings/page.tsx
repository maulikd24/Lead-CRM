import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatNumber } from "@/lib/utils/format";
import { PortfolioImportDialog } from "../households/portfolio-import-dialog";
import { SyncRecomputeButtons } from "./sync-recompute-buttons";
import { CreatePayoutRunDialog } from "./create-payout-run-dialog";
import { bulkImportRevenueAction } from "./import-actions";

const REVENUE_COLUMNS = ["accountNumber", "externalRef", "revenueType", "grossRevenueAmount", "eventDate"];

const PAYOUT_RUN_STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "success" | "destructive"> = {
  DRAFT: "outline",
  PENDING_APPROVAL: "secondary",
  APPROVED: "default",
  FINALIZED: "success",
  CANCELLED: "destructive",
};

export default async function EarningsPage() {
  const session = await requireRole(["ADMIN", "FINANCE"]);

  const [unaccruedRevenue, pendingAccruals, openRuns, runs] = await Promise.all([
    prisma.revenueEvent.count({ where: { accruals: { none: {} } } }),
    prisma.commissionAccrual.count({ where: { status: "ACCRUED" } }),
    prisma.payoutRun.count({ where: { status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED"] } } }),
    prisma.payoutRun.findMany({
      include: { createdBy: { select: { name: true } }, payouts: { select: { netPayableAmount: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Earnings"
        description={`Welcome, ${session.user.name}. Internal estimation & reporting only — no bank transfer is ever executed here.`}
        actions={
          <>
            <SyncRecomputeButtons />
            <PortfolioImportDialog
              label="Import Revenue (CSV)"
              title="Import Revenue CSV"
              description="Upserts RevenueEvent rows by externalRef — safe to re-run. The TradingAccount must already exist."
              columns={REVENUE_COLUMNS}
              templateFilename="revenue-import-template.csv"
              action={bulkImportRevenueAction}
            />
            <CreatePayoutRunDialog />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Revenue Events Without Accrual" value={unaccruedRevenue} />
        <StatCard label="Pending Accruals" value={pendingAccruals} />
        <StatCard label="Open Payout Runs" value={openRuns} />
      </div>

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payouts</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Created By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody striped>
              {runs.map((run) => {
                const total = run.payouts.reduce((sum, p) => sum + Number(p.netPayableAmount), 0);
                return (
                  <TableRow key={run.id}>
                    <TableCell>
                      <Link href={`/earnings/runs/${run.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                        {formatDate(run.periodStart)} – {formatDate(run.periodEnd)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={PAYOUT_RUN_STATUS_VARIANT[run.status] ?? "outline"}>{run.status.replace(/_/g, " ")}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{run.payouts.length}</TableCell>
                    <TableCell className="text-sm">₹{formatNumber(total)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{run.createdBy.name}</TableCell>
                  </TableRow>
                );
              })}
              {runs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No payout runs yet.
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
