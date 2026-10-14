import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatNumber } from "@/lib/utils/format";
import type { ClientSnapshot } from "@/lib/clients/snapshot";
import { PortfolioSummaryCard } from "./portfolio-summary-card";

const rupees = (value: number) => `₹${formatNumber(Math.round(value))}`;

/**
 * "At a glance" on the client Overview: Funds added, and the portfolio summary (name, total AUM, asset-class mix, last trading date),
 * which loads on demand. Holdings and trades are not shown anywhere on the page.
 */
export function ClientSnapshotCards({ clientId, funds, onOpenTab }: { clientId: string; funds: ClientSnapshot["funds"]; onOpenTab: (tab: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:gap-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Funds added</CardTitle>
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
      <PortfolioSummaryCard clientId={clientId} />
    </div>
  );
}
