import { ImageIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { CHANNEL_LABEL } from "@/lib/marketing/channels";
import type { CreativeReport } from "@/lib/marketing/creatives";
import { formatCount, formatMoney, formatPercent } from "@/lib/marketing/view-model";

import styles from "./marketing.module.css";
import { Rail, type RailFact } from "./rail";
import { TabLayout } from "./tab-layout";

/** Per-ad performance. Leads and cost per lead are the platform's own count; the CRM can only attribute a lead to a campaign. */
export function CreativeTab({ report, range, reporting }: { report: CreativeReport; range: { from: string; to: string }; reporting: string[] }) {
  const best = report.ads.find((a) => a.verdict === "best");
  const worst = report.ads.find((a) => a.verdict === "worst");
  const facts: RailFact[] = [
    { key: "ads", label: "Ads with spend", value: { n: report.totals.ads, kind: "count" }, hint: `${range.from} to ${range.to}` },
    { key: "spend", label: "Ad spend", value: { n: report.totals.spend, kind: "money", currency: report.currency } },
    { key: "best", label: "Cheapest per lead", value: best ? formatMoney(best.cpl, report.currency) : "Too early", hint: best ? best.adName : "Needs 5+ leads on two ads", tone: best ? "success" : undefined },
    { key: "worst", label: "Dearest per lead", value: worst ? formatMoney(worst.cpl, report.currency) : "Too early", hint: worst ? worst.adName : undefined, tone: worst ? "warning" : undefined },
  ];

  return (
    <TabLayout
      tab="creative"
      rail={<Rail facts={facts} />}
      main={
        report.ads.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={ImageIcon}
                title="No ad-level data in this range"
                description={reporting.length > 0 ? `${reporting.join(" and ")} reports per ad once the account has synced. Meta reports at campaign level only for now.` : "Per-ad reporting comes from Google Ads. Connect it in Apps & Integrations; Meta reports at campaign level only for now."}
              />
            </CardContent>
          </Card>
        ) : (
          <Card className={styles.enter}>
            <CardHeader>
              <CardTitle className="font-heading">Ads</CardTitle>
              <CardDescription>Spend, clicks and the platform&apos;s own lead count for every ad. Cost per lead here is the platform&apos;s view: the CRM can only attribute a lead to a campaign, not to an ad. {report.otherCurrencyRows > 0 ? `${report.otherCurrencyRows} rows in another currency were left out.` : ""}</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <div role="region" aria-label="Ads table, scrollable" tabIndex={0} className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                <table className="w-full min-w-[44rem] text-left text-sm">
                  <caption className="sr-only">Ads with spend, impressions, click-through rate, cost per click, leads and cost per lead</caption>
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th scope="col" className="px-3 py-2 pl-5 font-medium">Ad</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Spend</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Impressions</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">CTR</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Cost per click</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Leads</th>
                      <th scope="col" className="px-3 py-2 pr-5 text-right font-medium">Cost per lead</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.ads.map((a) => (
                      <tr key={`${a.channel}:${a.adId}`} className="border-b last:border-0 hover:bg-muted/40">
                        <th scope="row" className="max-w-72 px-3 py-3 pl-5 text-left font-medium">
                          <span className="block truncate" title={a.adName}>{a.adName}</span>
                          <span className="block truncate text-xs font-normal text-muted-foreground" title={a.campaignName}>{`${CHANNEL_LABEL[a.channel]} · ${a.campaignName}`}</span>
                          {a.verdict && <Badge className="mt-1.5" variant={a.verdict === "best" ? "success" : "warning"}>{a.verdict === "best" ? "Cheapest per lead" : "Dearest per lead"}</Badge>}
                        </th>
                        <td className="px-3 py-3 text-right tabular-nums">{formatMoney(a.spend, report.currency)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{formatCount(a.impressions)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{formatPercent(a.ctr)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{formatMoney(a.cpc, report.currency)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{formatCount(a.leads)}</td>
                        <td className="px-3 py-3 pr-5 text-right tabular-nums">{formatMoney(a.cpl, report.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )
      }
    />
  );
}
