import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime, formatNumber } from "@/lib/utils/format";
import type { TradeRow } from "@/lib/clients/snapshot";

export function TradingActivityCard({ trades, lastSyncedAt }: { trades: TradeRow[]; lastSyncedAt: Date | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Trading activity</CardTitle>
        <CardDescription>
          Latest trades from the back office{lastSyncedAt ? ` · last synced ${formatDateTime(lastSyncedAt)}` : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Account</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody striped>
              {trades.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-sm">{formatDate(t.date)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{t.type.replace(/_/g, " ")}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{t.productName ?? "—"}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{t.quantity !== null ? formatNumber(t.quantity) : "—"}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{t.price !== null ? `₹${formatNumber(t.price)}` : "—"}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">₹{formatNumber(Math.round(t.amount))}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{t.accountNumber}</TableCell>
                </TableRow>
              ))}
              {trades.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                    No trades synced yet. An Admin or Manager can import them from Households → Import Transactions.
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
