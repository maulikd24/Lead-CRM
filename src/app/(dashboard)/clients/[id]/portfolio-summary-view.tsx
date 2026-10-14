import type { PortfolioSummary } from "@/lib/clients/portfolio-aggregate";
import { formatDate, formatNumber } from "@/lib/utils/format";

/** The one rendering of a PortfolioSummary: name, total AUM, asset-class mix, last trading date. Used by the customer card and the household page. */
export function PortfolioSummaryView({ data }: { data: PortfolioSummary }) {
  return (
    <>
    <p className="text-sm font-medium">{data.name}</p>
    {data.totalAum > 0 ? (
      <>
        <p className="font-heading text-2xl font-semibold tabular-nums">₹{formatNumber(Math.round(data.totalAum))}</p>
        <p className="text-xs text-muted-foreground">Total AUM{data.asOf ? ` as of ${formatDate(new Date(data.asOf))}` : ""}</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {data.mix.map((row) => (
            <li key={row.bucket}>
              <span className="text-muted-foreground">{row.bucket}</span> <span className="font-medium tabular-nums">{row.pct}%</span>
            </li>
          ))}
        </ul>
      </>
    ) : (
      <p className="text-sm text-muted-foreground">No portfolio synced yet.</p>
    )}
    <p className="text-xs text-muted-foreground">Last trading date: {data.lastTradingDate ? formatDate(new Date(data.lastTradingDate)) : "none yet"}</p>
    </>
  );
}
