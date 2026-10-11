import { Suspense } from "react";
import { notFound } from "next/navigation";

import { WorkspaceShell } from "@/components/workspace";
import { requireMarketing } from "@/lib/auth/require-role";
import { loadCreativesFor } from "@/lib/marketing/creatives-db";
import { creativeAccess } from "@/lib/creative/flags";
import { googleAdsReportingEnabled, marketingPageEnabled, socialDraftsEnabled } from "@/lib/marketing/flags";
import { getWorkspaceClock, loadMarketingWorkspaceFor } from "@/lib/marketing/report";
import { monthGrid } from "@/lib/marketing/zoned-time";
import { parseRange } from "@/lib/marketing/view-model";
import { parseChannelFilter, parseTab, parseView, type TabKey } from "@/lib/marketing/workspace-params";

import { BriefsTab } from "./briefs-tab";
import { CampaignsTab } from "./campaigns-tab";
import { CompetitorsTab } from "./competitors-tab";
import { ExperimentsTab } from "./experiments-tab";
import { InsightsTab } from "./insights-tab";
import { ReportsTab } from "./reports-tab";
import { CreativeTab } from "./creative-tab";
import { ImpactTab } from "./impact-tab";
import { canAccessMarketing } from "@/lib/access/marketing-access";
import { attributionEnabled } from "@/lib/attribution/flag";
import { OverviewTab } from "./overview-tab";
import { PostsTab } from "./posts-tab";
import { RangeControl } from "./range-control";
import { WorkspaceSkeleton } from "./skeleton";
import { MarketingTabs, WorkspaceHeading } from "./workspace-header";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

async function ImpactContent({ params, viewer }: { params: Params; viewer: { id: string; role: string } }) {
  const clock = await getWorkspaceClock((today) => parseRange(params, today));
  const single = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  return <ImpactTab range={clock.range} compare={single(params.compare) === "1"} campaign={single(params.campaign)} viewer={viewer} />;
}

async function TabContent({ tab, params, isAdmin, social, role }: { tab: "overview" | "campaigns" | "creative"; params: Params; isAdmin: boolean; social: boolean; role: string }) {
  const data = await loadMarketingWorkspaceFor(role, (today) => parseRange(params, today));
  if (tab === "overview") return <OverviewTab data={data} isAdmin={isAdmin} socialOn={social} />;
  if (tab === "campaigns") return <CampaignsTab data={data} channel={parseChannelFilter(params, data.channels.map((c) => c.channel))} />;
  const reporting = data.channels.filter((c) => c.channel === "google" && c.report).map((c) => c.label);
  const creatives = await loadCreativesFor(role, data.range, data.channels.filter((c) => c.channel === "google").map((c) => c.channel));
  return <CreativeTab report={creatives} range={data.range} reporting={reporting} />;
}

export default async function MarketingPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!marketingPageEnabled()) notFound();
  const session = await requireMarketing();
  const params = await searchParams;
  const social = socialDraftsEnabled();
  // Campaign impact shows spend and return: ADMIN and MARKETING only.
  const attribution = attributionEnabled() && canAccessMarketing(session.user.role);
  const access = creativeAccess(session.user.role);
  const tab = parseTab(params, { social, attribution, creative: access.creative, reports: access.reports });
  const isAdmin = session.user.role === "ADMIN";

  const adTab = tab === "overview" || tab === "campaigns" || tab === "creative" || tab === "intel" || tab === "impact";
  const clock = tab !== "posts" ? await getWorkspaceClock((today) => parseRange(params, today)) : null;
  const channels = googleAdsReportingEnabled() ? (["meta", "google"] as const) : (["meta"] as const);
  const channel = parseChannelFilter(params, channels);
  const single = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const postId = single(params.post);
  const view = parseView(params);
  const month = monthGrid(single(params.month) ?? "").month;

  return (
    <WorkspaceShell hasRail header={<WorkspaceHeading />} tabs={<MarketingTabs tab={tab} social={social} attribution={attribution} creative={access.creative} reports={access.reports} range={adTab ? (clock?.range ?? null) : null} channel={channel} />} toolbar={clock && adTab ? <RangeControl range={clock.range} today={clock.today} tab={tab} channel={channel} /> : undefined}>
      <Suspense key={JSON.stringify([tab, params])} fallback={<WorkspaceSkeleton />}>
        {tab === "posts" ? (
          <PostsTab view={view} month={month} postId={postId} isAdmin={isAdmin} viewerId={session.user.id} />
        ) : tab === "impact" ? (
          <ImpactContent params={params} viewer={{ id: session.user.id, role: session.user.role }} />
        ) : tab === "intel" ? (
          <InsightsTab range={clock!.range} />
        ) : tab === "briefs" ? (
          <BriefsTab viewerId={session.user.id} isAdmin={isAdmin} today={clock!.today} />
        ) : tab === "experiments" ? (
          <ExperimentsTab today={clock!.today} />
        ) : tab === "competitors" ? (
          <CompetitorsTab today={clock!.today} />
        ) : tab === "reports" ? (
          <ReportsTab params={params} today={clock!.today} isAdmin={isAdmin} now={new Date()} />
        ) : (
          <TabContent tab={tab} params={params} isAdmin={isAdmin} social={social} role={session.user.role} />
        )}
      </Suspense>
    </WorkspaceShell>
  );
}
