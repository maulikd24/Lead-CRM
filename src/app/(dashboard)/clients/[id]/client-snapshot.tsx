import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatNumber } from "@/lib/utils/format";
import type { ClientSnapshot } from "@/lib/clients/snapshot";

const rupees = (value: number) => `₹${formatNumber(Math.round(value))}`;

/** "At a glance" row on the client Overview: AUM, Funds Added (Yes/No + amount), Last Trade. */
export function ClientSnapshotCards({ snapshot, onOpenTab }: { snapshot: ClientSnapshot; onOpenTab: (tab: string) => void }) {
  const { aum, funds, lastTrade } = snapshot;
  const trade = lastTrade.trade;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">AUM</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {aum.holdingsCount > 0 ? (
            <>
              <p className="font-heading text-2xl font-semibold tabular-nums">{rupees(aum.total)}</p>
              <p className="text-xs text-muted-foreground">
                {aum.holdingsCount} holding{aum.holdingsCount === 1 ? "" : "s"} across {aum.accountsCount} account{aum.accountsCount === 1 ? "" : "s"}
                {aum.asOf ? ` · as of ${formatDate(aum.asOf)}` : ""}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {aum.allocation.map((row) => (
                  <Badge key={row.bucket} variant="outline" className="text-[10px]">
                    {row.bucket} {row.pct}%
                  </Badge>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No holdings synced yet.</p>
          )}
          {aum.pipelineEstimatedAum > 0 && (
            <p className="text-xs text-muted-foreground">
              + {rupees(aum.pipelineEstimatedAum)} estimated in the{" "}
              <button type="button" className="underline" onClick={() => onOpenTab("opportunities")}>
                opportunity pipeline
              </button>
            </p>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Funds Added</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Badge variant={funds.added ? "success" : "outline"}>{funds.added ? "Yes" : "No"}</Badge>
            {funds.added && (funds.amount ?? funds.paymentsReceived) !== null && (
              <span className="font-heading text-2xl font-semibold tabular-nums">{rupees((funds.amount ?? funds.paymentsReceived) as number)}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {funds.status ? funds.status.replace(/_/g, " ").toLowerCase() : "Funding not started"}
            {funds.date ? ` · ${formatDate(funds.date)}` : ""}
          </p>
          {funds.paymentsReceived !== null && (
            <p className="text-xs text-muted-foreground">
              {funds.amount !== null ? "Payments received per back office:" : "Per back-office payments:"} {rupees(funds.paymentsReceived)} (
              <button type="button" className="underline" onClick={() => onOpenTab("funding")}>
                history
              </button>
              )
            </p>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Last Trade</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {trade ? (
            <>
              <p className="text-sm font-medium">
                <Badge variant={trade.type === "SELL" || trade.type === "REDEMPTION" ? "warning" : "success"} className="mr-2">
                  {trade.type.replace(/_/g, " ")}
                </Badge>
                {trade.productName ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDate(trade.date)} · {rupees(trade.amount)}
                {trade.quantity !== null && trade.price !== null ? ` · ${formatNumber(trade.quantity)} × ₹${formatNumber(trade.price)}` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {lastTrade.tradesLast30Days} trade{lastTrade.tradesLast30Days === 1 ? "" : "s"} in the last 30 days ·{" "}
                <button type="button" className="underline" onClick={() => onOpenTab("wealth")}>
                  all trading activity
                </button>
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No trades synced yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
