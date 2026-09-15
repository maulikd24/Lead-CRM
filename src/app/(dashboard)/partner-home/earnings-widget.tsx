import { prisma } from "@/lib/db/prisma";
import { getVisibleScope } from "@/lib/policy/visibility";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatNumber } from "@/lib/utils/format";
import type { PayoutStatus, Role } from "@/generated/prisma/client";

const PAYOUT_STATUS_VARIANT: Record<PayoutStatus, "outline" | "default" | "success"> = {
  ESTIMATED: "outline",
  APPROVED: "default",
  RECONCILED_EXTERNALLY: "success",
};

/**
 * Partner-facing, read-only earnings summary. Always scoped via getVisibleScope(actor) so a
 * Distributor sees their own + descendant sub-partners' numbers and a Partner/Affiliate sees only
 * their own — never a raw partnerProfileId param that a caller could substitute.
 */
export async function EarningsWidget({ actor }: { actor: { id: string; role: Role } }) {
  const scope = await getVisibleScope(actor.id, actor.role);
  const partnerProfileIds = scope.partnerProfileIds ?? [];
  if (partnerProfileIds.length === 0) return null;

  const [accruedTotal, payouts] = await Promise.all([
    prisma.commissionAccrual.aggregate({
      where: { partnerProfileId: { in: partnerProfileIds }, status: "ACCRUED" },
      _sum: { accrualAmount: true },
    }),
    prisma.payout.findMany({
      where: { partnerProfileId: { in: partnerProfileIds } },
      include: { payoutRun: { select: { periodStart: true, periodEnd: true } } },
      orderBy: { payoutRun: { periodStart: "desc" } },
      take: 10,
    }),
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Earnings</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <StatCard label="Estimated (Not Yet in a Payout Run)" value={`₹${formatNumber(Number(accruedTotal._sum.accrualAmount ?? 0))}`} />
          <StatCard label="Payout Runs on File" value={payouts.length} />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>Net Payable</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody striped>
            {payouts.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="text-sm">
                  {formatDate(p.payoutRun.periodStart)} – {formatDate(p.payoutRun.periodEnd)}
                </TableCell>
                <TableCell className="text-sm font-medium">₹{formatNumber(Number(p.netPayableAmount))}</TableCell>
                <TableCell>
                  <Badge variant={PAYOUT_STATUS_VARIANT[p.status]}>{p.status.replace(/_/g, " ")}</Badge>
                </TableCell>
              </TableRow>
            ))}
            {payouts.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                  No payouts on file yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
