import { Card, CardContent } from "@/components/ui/card";
import type { ChannelSummary } from "@/lib/marketing/blend";
import type { AdChannel } from "@/lib/marketing/channels";
import { cn } from "@/lib/utils";
import { formatCount, formatMoney, formatRatio } from "@/lib/marketing/view-model";

import styles from "./marketing.module.css";

const COLOR: Record<AdChannel, string> = { meta: "bg-chart-2", google: "bg-chart-3" };

/** One card per channel: its share of spend and what it returned. Shown beside each other so the channels can be compared at a glance. */
export function ChannelCards({ channels, currency }: { channels: ChannelSummary[]; currency: string | null }) {
  return (
    <section aria-label="Channels compared" className="grid gap-2.5 sm:grid-cols-2">
      {channels.map((c, i) => (
        <Card key={c.channel} size="sm" className={cn(styles.enter, styles.lift)} style={{ ["--i" as string]: i + 6 }}>
          <CardContent className="flex flex-col gap-3 px-4">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-heading text-sm font-semibold">{`${c.label} Ads`}</h3>
              <p className="text-xs tabular-nums text-muted-foreground">{`${formatCount(c.campaigns)} campaigns`}</p>
            </div>
            <div>
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="font-medium tabular-nums">{formatMoney(c.spend, currency)}</span>
                <span className="text-muted-foreground tabular-nums">{`${Math.round(c.spendShare * 100)}% of spend`}</span>
              </div>
              <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className={cn(styles.shareBar, "h-full rounded-full", COLOR[c.channel])} style={{ width: `${Math.max(2, c.spendShare * 100)}%`, ["--i" as string]: i }} />
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-x-2 gap-y-2 text-xs">
              {[
                ["Leads", formatCount(c.crmLeads)],
                ["Cost per lead", formatMoney(c.cpl, currency)],
                ["Funded", formatCount(c.funded)],
                ["Revenue", formatMoney(c.revenue, "INR")],
                ["ROAS", formatRatio(c.roas)],
                ["Per funded", formatMoney(c.costPerFunded, currency)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-heading text-sm font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
