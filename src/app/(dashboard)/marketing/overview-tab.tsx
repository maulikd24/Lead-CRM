import Link from "next/link";
import { Megaphone, Plug } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import type { WorkspaceData } from "@/lib/marketing/report";
import { formatCount, formatMoney } from "@/lib/marketing/view-model";
import { channelFacts, overviewKpis } from "@/lib/marketing/workspace-view";
import { workspaceHref } from "@/lib/marketing/workspace-params";

import { BlendedChart } from "./blended-chart";
import { ChannelCards } from "./channel-cards";
import { KpiTiles } from "./kpi-tiles";
import { Rail, type RailFact } from "./rail";
import { StatusBanners } from "./status-banners";
import { TabLayout } from "./tab-layout";

export function OverviewTab({ data, isAdmin, socialOn }: { data: WorkspaceData; isAdmin: boolean; socialOn: boolean }) {
  const { blended, channels, range } = data;
  const connectionBanners = channels.flatMap((c) => c.connection.banners.map((b) => ({ ...b, text: b.text })));
  const facts: RailFact[] = channelFacts(channels).map((f) => ({ ...f }));
  facts.push({ key: "range", label: "Showing", value: `${range.from} to ${range.to}`, hint: `Days in ${data.timezone}` });

  const actions = (
    <>
      <Button size="sm" variant="outline" render={<Link href={workspaceHref({ tab: "campaigns", range })} scroll={false} />}>All campaigns</Button>
      {socialOn && <Button size="sm" variant="outline" render={<Link href={workspaceHref({ tab: "posts", post: "new" })} scroll={false} />}>New post draft</Button>}
      {isAdmin && <Button size="sm" variant="ghost" render={<Link href="/settings/integrations" />}>Connections</Button>}
    </>
  );

  if (!blended) {
    const anyWaiting = channels.some((c) => c.connection.state === "waiting");
    return (
      <TabLayout
        tab="overview"
        rail={<Rail facts={facts} actions={actions} />}
        main={
          <>
            <StatusBanners banners={connectionBanners} />
            <Card>
              <CardContent>
                <EmptyState
                  icon={anyWaiting ? Megaphone : Plug}
                  title={anyWaiting ? "Waiting for the first sync" : "No ad channel is connected"}
                  description={anyWaiting ? "No ad spend has been pulled in yet. This page fills in after the first successful sync." : isAdmin ? "Connect an ad account in Apps & Integrations. It takes read-only credentials, and the numbers fill in here after the first sync." : "Ask an Admin to connect an ad account in Apps & Integrations. The numbers fill in here after the first sync."}
                  action={isAdmin ? { label: "Open Apps & Integrations", href: "/settings/integrations" } : undefined}
                />
              </CardContent>
            </Card>
          </>
        }
      />
    );
  }

  const top = blended.campaigns[0];
  const attention = blended.campaigns.filter((c) => c.quality.tone === "warning" || c.quality.tone === "destructive").length;
  if (top) facts.push({ key: "top", label: "Biggest spender", value: formatMoney(top.spend, blended.currency), hint: top.name });
  facts.push({ key: "attention", label: "Campaigns to look at", value: { n: attention, kind: "count" }, hint: attention > 0 ? "Flagged on the Campaigns tab" : "None flagged", tone: attention > 0 ? "warning" : "success" });
  facts.push({ key: "unattributed", label: "Unattributed leads", value: { n: blended.unattributed.leads, kind: "count" }, hint: blended.totals.crmLeads > 0 ? `of ${formatCount(blended.totals.crmLeads)} ad leads` : undefined });

  const empty = blended.campaigns.length === 0 && blended.totals.crmLeads === 0;
  return (
    <TabLayout
      tab="overview"
      rail={<Rail facts={facts} actions={actions} />}
      main={
        <>
          <StatusBanners banners={[...connectionBanners, ...blended.notes]} />
          {empty ? (
            <Card>
              <CardContent>
                <EmptyState icon={Megaphone} title="No spend or ad leads in this range" description="Try a longer range. If this stays empty while ads are running, check the sync status in the panel on the right." />
              </CardContent>
            </Card>
          ) : (
            <>
              <KpiTiles kpis={overviewKpis(blended.totals)} currency={blended.currency} />
              <BlendedChart daily={blended.daily} channels={blended.channels.map((c) => c.channel)} currency={blended.currency} />
              <ChannelCards channels={blended.channels} currency={blended.currency} />
              <p className="text-xs text-muted-foreground">Outcomes follow the leads created in the range, wherever those customers are today, so recent days look weaker than they will once those leads have had time to complete KYC and fund. Revenue is brokerage and advisory fees net of reversals and is indicative until Finance confirms the revenue model.</p>
            </>
          )}
        </>
      }
    />
  );
}
