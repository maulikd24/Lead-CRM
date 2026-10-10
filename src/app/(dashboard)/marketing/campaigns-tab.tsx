import Link from "next/link";
import { Megaphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import type { AdChannel } from "@/lib/marketing/channels";
import type { WorkspaceData } from "@/lib/marketing/report";
import { formatCount } from "@/lib/marketing/view-model";
import { workspaceHref } from "@/lib/marketing/workspace-params";

import { CampaignTable } from "./campaign-table";
import { Funnel } from "./funnel";
import { Rail, type RailFact } from "./rail";
import { StatusBanners } from "./status-banners";
import { TabLayout } from "./tab-layout";
import { UnattributedCard } from "./unattributed-card";

export function CampaignsTab({ data, channel }: { data: WorkspaceData; channel: AdChannel | "all" }) {
  const { blended, channels, range } = data;
  const rails = (facts: RailFact[]) => <Rail facts={facts} />;
  if (!blended) {
    return <TabLayout tab="campaigns" rail={rails([])} main={<Card><CardContent><EmptyState icon={Megaphone} title="No campaign data yet" description="Connect an ad channel in Apps & Integrations. Campaigns appear here after the first sync." /></CardContent></Card>} />;
  }

  const chosen = channel === "all" ? null : channels.find((c) => c.channel === channel)?.report ?? null;
  const rows = channel === "all" ? blended.campaigns : blended.campaigns.filter((c) => c.channel === channel);
  const funnel = chosen ? chosen.funnel : blended.funnel;
  const unattributed = chosen ? chosen.unattributed : blended.unattributed;
  const excluded = chosen ? { otherChannel: chosen.excluded.nonMeta, duplicates: chosen.excluded.duplicates } : blended.excluded;
  const totalLeads = chosen ? chosen.totals.crmLeads : blended.totals.crmLeads;
  const flagged = rows.filter((c) => c.quality.tone === "warning" || c.quality.tone === "destructive");
  const reports = channels.filter((c) => c.report);

  const facts: RailFact[] = [
    { key: "campaigns", label: "Campaigns", value: { n: rows.length, kind: "count" }, hint: channel === "all" ? "Across every channel" : "In this channel" },
    { key: "flagged", label: "Need a look", value: { n: flagged.length, kind: "count" }, tone: flagged.length > 0 ? "warning" : "success", hint: flagged[0] ? `Starting with ${flagged[0].name}` : "None flagged" },
    { key: "unattributed", label: "Unattributed leads", value: { n: unattributed.leads, kind: "count" }, hint: `of ${formatCount(totalLeads)} ad leads` },
  ];

  const chip = (key: AdChannel | "all", label: string) => (
    <Button key={key} size="sm" variant={channel === key ? "default" : "outline"} aria-current={channel === key ? "true" : undefined} render={<Link href={workspaceHref({ tab: "campaigns", range, channel: key })} scroll={false} />}>
      {label}
    </Button>
  );

  return (
    <TabLayout
      tab="campaigns"
      rail={<Rail facts={facts}>{funnel.length > 0 && <Funnel steps={funnel} />}</Rail>}
      main={
        <>
          <StatusBanners banners={[...channels.flatMap((c) => c.connection.banners), ...blended.notes]} />
          {reports.length > 1 && (
            <nav aria-label="Filter by channel" className="flex flex-wrap items-center gap-1.5">
              {chip("all", "All channels")}
              {reports.map((c) => chip(c.channel, `${c.label} Ads`))}
            </nav>
          )}
          {rows.length === 0 ? (
            <Card><CardContent><EmptyState icon={Megaphone} title="No campaigns with spend in this range" description="Try a longer range, or another channel." /></CardContent></Card>
          ) : (
            <CampaignTable key={channel} campaigns={rows} currency={blended.currency} showChannel={channel === "all" && reports.length > 1} />
          )}
          <UnattributedCard unattributed={unattributed} excluded={excluded} totalLeads={totalLeads} currency={blended.currency} />
        </>
      }
    />
  );
}
