import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { FunnelStep } from "@/lib/marketing/metrics";
import { formatCount, formatPercent, funnelBars } from "@/lib/marketing/view-model";

import styles from "./marketing.module.css";

const PREVIOUS_LABEL: Record<string, string> = { clicks: "of impressions", kyc: "of leads", funded: "of leads" };

/** Ad click to funded customer. The bars are decorative; the list beside them carries every number as text. */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const bars = funnelBars(steps);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">From ad to funded customer</CardTitle>
        <CardDescription>Impressions and clicks are what Meta reports. Leads, KYC and funded come from the CRM, for leads created in the range. Instant-form leads need no click, so leads per 100 clicks is only a rough guide. Bar lengths are on a log scale so the small end stays visible.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-3">
          {bars.map((bar, i) => (
            <li key={bar.key} className="grid grid-cols-[7.5rem_1fr] items-center gap-3 sm:grid-cols-[9rem_1fr_11rem]">
              <span className="text-sm text-muted-foreground">{bar.label}</span>
              <div className="h-7 rounded-md bg-muted" aria-hidden>
                <div className={`${styles.funnelBar} h-full rounded-md bg-primary`} style={{ width: `${bar.widthPct}%`, ["--i" as string]: i, opacity: 1 - i * 0.12 }} />
              </div>
              <span className="col-span-2 flex items-baseline justify-between gap-2 text-sm tabular-nums sm:col-span-1 sm:justify-end sm:text-right">
                <span className="font-heading font-semibold">{formatCount(bar.value)}</span>
                {bar.rateFromPrevious !== null && (
                  <span className="text-xs text-muted-foreground">
                    {bar.key === "leads" ? `${(bar.rateFromPrevious * 100).toFixed(1)} per 100 clicks` : `${formatPercent(bar.rateFromPrevious)} ${PREVIOUS_LABEL[bar.key] ?? ""}`}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
