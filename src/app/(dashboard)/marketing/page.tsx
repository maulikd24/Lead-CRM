import { Suspense } from "react";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/require-role";
import { loadCreatives } from "@/lib/marketing/creatives-db";
import { googleAdsReportingEnabled, marketingPageEnabled, socialDraftsEnabled } from "@/lib/marketing/flags";
import { getWorkspaceClock, loadMarketingWorkspace } from "@/lib/marketing/report";
import { monthGrid } from "@/lib/marketing/zoned-time";
import { parseRange } from "@/lib/marketing/view-model";
import { parseChannelFilter, parseTab, parseView, type TabKey } from "@/lib/marketing/workspace-params";

import { CampaignsTab } from "./campaigns-tab";
import { CreativeTab } from "./creative-tab";
import { OverviewTab } from "./overview-tab";
import { PostsTab } from "./posts-tab";
import { WorkspaceSkeleton } from "./skeleton";
import styles from "./marketing.module.css";
import { WorkspaceHeader } from "./workspace-header";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

async function TabContent({ tab, params, isAdmin, social }: { tab: Exclude<TabKey, "posts">; params: Params; isAdmin: boolean; social: boolean }) {
  const data = await loadMarketingWorkspace((today) => parseRange(params, today));
  if (tab === "overview") return <OverviewTab data={data} isAdmin={isAdmin} socialOn={social} />;
  if (tab === "campaigns") return <CampaignsTab data={data} channel={parseChannelFilter(params, data.channels.map((c) => c.channel))} />;
  const reporting = data.channels.filter((c) => c.channel === "google" && c.report).map((c) => c.label);
  const creatives = await loadCreatives(data.range, data.channels.filter((c) => c.channel === "google").map((c) => c.channel));
  return <CreativeTab report={creatives} range={data.range} reporting={reporting} />;
}

export default async function MarketingPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!marketingPageEnabled()) notFound();
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const params = await searchParams;
  const social = socialDraftsEnabled();
  const tab = parseTab(params, { social });
  const isAdmin = session.user.role === "ADMIN";

  const adTab = tab !== "posts";
  const clock = adTab ? await getWorkspaceClock((today) => parseRange(params, today)) : null;
  const channels = googleAdsReportingEnabled() ? (["meta", "google"] as const) : (["meta"] as const);
  const channel = parseChannelFilter(params, channels);
  const single = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const postId = single(params.post);
  const view = parseView(params);
  const month = monthGrid(single(params.month) ?? "").month;

  return (
    <div className={styles.workspace}>
      <WorkspaceHeader tab={tab} social={social} range={clock?.range ?? null} today={clock?.today ?? ""} channel={channel} />
      <Suspense key={JSON.stringify([tab, params])} fallback={<WorkspaceSkeleton />}>
        {tab === "posts" ? <PostsTab view={view} month={month} postId={postId} isAdmin={isAdmin} viewerId={session.user.id} /> : <TabContent tab={tab} params={params} isAdmin={isAdmin} social={social} />}
      </Suspense>
    </div>
  );
}
