import { ShowFirstBlock } from "@/components/workspace";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime, formatNumber } from "@/lib/utils/format";
import type { TradeRow } from "@/lib/clients/snapshot";

export function TradingActivityCard({ trades, lastSyncedAt }: { trades: TradeRow[]; lastSyncedAt: Date | null }) {
  return (
    <Card className="max-lg:gap-2 max-lg:py-3">
      <CardHeader>
        <CardTitle className="text-base">Trading activity</CardTitle>
        <CardDescription className="max-lg:hidden">
          Latest trades from the back office{lastSyncedAt ? ` · last synced ${formatDateTime(lastSyncedAt)}` : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ShowFirstBlock name="trades" title="All trading activity" noun="trades" total={trades.length} preview={<TradesTable trades={trades.slice(0, 5)} />} full={<TradesTable trades={trades} />} />
      </CardContent>
    </Card>
  );
}

function TradesTable({ trades }: { trades: TradeRow[] }) {
  return (
    <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right max-lg:hidden">Qty</TableHead>
                <TableHead className="text-right max-lg:hidden">Price</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="max-lg:hidden">Account</TableHead>
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
                  <TableCell className="text-right text-sm tabular-nums max-lg:hidden">{t.quantity !== null ? formatNumber(t.quantity) : "—"}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums max-lg:hidden">{t.price !== null ? `₹${formatNumber(t.price)}` : "—"}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">₹{formatNumber(Math.round(t.amount))}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground max-lg:hidden">{t.accountNumber}</TableCell>
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
  );
}
