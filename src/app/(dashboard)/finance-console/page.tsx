import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatNumber } from "@/lib/utils/format";
import { ApprovalQueue } from "../settings/approval-workflows/approval-queue";
import { MarkReconciledDialog } from "./mark-reconciled-dialog";

export default async function FinanceConsolePage() {
  const session = await requireRole(["FINANCE", "ADMIN"]);

  const [requests, awaitingReconciliation] = await Promise.all([
    prisma.approvalRequest.findMany({
      where: { status: "PENDING" },
      include: { requestedBy: { select: { name: true } } },
      orderBy: { requestedAt: "asc" },
    }),
    prisma.payout.findMany({
      where: { status: "APPROVED" },
      include: { partnerProfile: { include: { user: { select: { name: true } } } }, payoutRun: { select: { periodStart: true, periodEnd: true } } },
      orderBy: { payoutRun: { periodEnd: "desc" } },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Finance Console" description={`Welcome, ${session.user.name}.`} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revenue Reconciliation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Approved payouts awaiting confirmation from Allvest&apos;s external finance system —
            this app estimates and reports only, it never executes the transfer itself.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Net Payable</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody striped>
              {awaitingReconciliation.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm">{p.partnerProfile.user.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(p.payoutRun.periodStart)} – {formatDate(p.payoutRun.periodEnd)}
                  </TableCell>
                  <TableCell className="text-sm font-medium">₹{formatNumber(Number(p.netPayableAmount))}</TableCell>
                  <TableCell>
                    <MarkReconciledDialog payoutId={p.id} />
                  </TableCell>
                </TableRow>
              ))}
              {awaitingReconciliation.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    Nothing awaiting reconciliation.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Same component as Settings &gt; Approval Workflows, view-only here (an Admin decides;
          Finance can only monitor via canDecide={session.user.role === "ADMIN"}). */}
      <ApprovalQueue requests={requests} canDecide={session.user.role === "ADMIN"} />
    </div>
  );
}
