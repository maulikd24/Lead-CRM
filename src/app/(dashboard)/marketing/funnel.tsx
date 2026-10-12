import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FunnelStep } from "@/lib/marketing/metrics";
import { formatCount, formatPercent, funnelBars } from "@/lib/marketing/view-model";

import styles from "./marketing.module.css";

const PREVIOUS_LABEL: Record<string, string> = { clicks: "of impressions", kyc: "of leads", funded: "of leads" };

/** Ad click to funded customer, as a compact vertical list that fits the rail. Bars are decorative; every number is text. */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const bars = funnelBars(steps);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="font-heading text-sm">From ad to funded customer</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-2.5">
          {bars.map((bar, i) => (
            <li key={bar.key} className="flex flex-col gap-1">
              <span className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{bar.label}</span>
                <span className="tabular-nums">
                  <span className="font-heading text-sm font-semibold">{formatCount(bar.value)}</span>
                  {bar.rateFromPrevious !== null && (
                    <span className="ml-1.5 text-muted-foreground">{bar.key === "leads" ? `${(bar.rateFromPrevious * 100).toFixed(1)} per 100 clicks` : `${formatPercent(bar.rateFromPrevious)} ${PREVIOUS_LABEL[bar.key] ?? ""}`}</span>
                  )}
                </span>
              </span>
              <div className="h-2 rounded-full bg-muted" aria-hidden>
                <div className={`${styles.funnelBar} h-full rounded-full bg-primary`} style={{ width: `${bar.widthPct}%`, ["--i" as string]: i, opacity: 1 - i * 0.12 }} />
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">Impressions and clicks come from the ad platforms; leads, KYC and funded from the CRM, for leads created in the range. Bars are on a log scale so the small end stays visible.</p>
      </CardContent>
    </Card>
  );
}
