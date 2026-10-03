import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime, formatNumber } from "@/lib/utils/format";
import type { PaymentRow, PaymentTotals } from "@/lib/clients/snapshot";

const rupees = (value: number) => `₹${formatNumber(Math.round(value))}`;

const TYPE_LABEL: Record<string, string> = { FUNDS_IN: "Funds in", FUNDS_OUT: "Funds out", FEE: "Fee", OTHER: "Other" };

export function PaymentsCard({ payments, totals }: { payments: PaymentRow[]; totals: PaymentTotals }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Payments history</CardTitle>
        <CardDescription>
          Money movements from the back office{totals.lastSyncedAt ? ` · last synced ${formatDateTime(totals.lastSyncedAt)}` : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-6 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Received</p>
            <p className="font-medium tabular-nums">{rupees(totals.fundsIn)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Withdrawn</p>
            <p className="font-medium tabular-nums">{rupees(totals.fundsOut)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Fees</p>
            <p className="font-medium tabular-nums">{rupees(totals.fees)}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody striped>
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm">{formatDate(p.paidAt)}</TableCell>
                  <TableCell className="text-sm">{TYPE_LABEL[p.type] ?? p.type}</TableCell>
                  <TableCell className="text-sm">{p.mode ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{p.referenceNumber ?? "—"}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{rupees(p.amount)}</TableCell>
                  <TableCell>
                    <Badge variant={p.status === "SUCCESS" ? "success" : p.status === "FAILED" ? "destructive" : "warning"}>
                      {p.status.toLowerCase()}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {payments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    No payments synced yet. An Admin or Manager can import them from Households → Import Payments.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
