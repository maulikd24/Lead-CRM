import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MarketingReport } from "@/lib/marketing/metrics";
import { formatCount, formatMoney, formatPercent } from "@/lib/marketing/view-model";
import { motion } from "@/components/workspace";


const REASONS: { key: keyof MarketingReport["unattributed"]["reasons"]; title: string; why: string }[] = [
  { key: "no_campaign_info", title: "Arrived with no campaign details", why: "The lead came from the ad platform but carried no campaign id, name or utm_campaign, so there is nothing to match on." },
  { key: "no_match", title: "Campaign not found in the synced ads", why: "The lead names a campaign that has no spend in the synced data: an older campaign, another ad account, or a renamed one that was never synced." },
  { key: "ambiguous_campaign_name", title: "Name shared by several campaigns", why: "Two campaigns have the same name and neither stood out as the one running on that day. Unique campaign names remove this." },
];

export function UnattributedCard({ unattributed, excluded, totalLeads, currency }: { unattributed: MarketingReport["unattributed"]; excluded: { otherChannel: number; duplicates: number }; totalLeads: number; currency: string | null }) {
  const share = totalLeads > 0 ? unattributed.leads / totalLeads : null;
  return (
    <Card className={motion.enter}>
      <CardHeader>
        <CardTitle className="font-heading">Unattributed leads</CardTitle>
        <CardDescription>
          Leads from these ad channels that we could not tie to one synced campaign. They still count in the totals and the funnel, just not against a campaign row, so no campaign is blamed or credited for them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="font-heading text-3xl font-semibold tabular-nums">{formatCount(unattributed.leads)}</p>
          <p className="text-sm text-muted-foreground">
            {share === null ? "No ad leads in this range." : `${formatPercent(share)} of ad leads. ${formatCount(unattributed.kyc)} KYC approved, ${formatCount(unattributed.funded)} funded, ${formatMoney(unattributed.aum, "INR")} AUM.`}
          </p>
        </div>
        {unattributed.leads > 0 && (
          <ul className="flex flex-col gap-2">
            {REASONS.filter((r) => unattributed.reasons[r.key] > 0).map((r) => (
              <li key={r.key} className="rounded-md border bg-muted/30 p-3 text-sm">
                <p className="font-medium">{`${r.title}: ${formatCount(unattributed.reasons[r.key])}`}</p>
                <p className="text-muted-foreground">{r.why}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          To raise the match rate, add <code>utm_campaign={"{{campaign.id}}"}</code> (Meta) or <code>utm_campaign={"{campaignid}"}</code> (Google) to ad URLs and keep campaign names unique.
          {` Left out of this report: ${formatCount(excluded.otherChannel)} leads from other sources and ${formatCount(excluded.duplicates)} duplicates. Spend in ${currency ?? "the account currency"} only.`}
        </p>
      </CardContent>
    </Card>
  );
}
