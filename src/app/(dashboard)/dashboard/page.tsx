import { Fragment, Suspense, type ReactNode } from "react";
import { AiSummaryCard } from "@/components/ai-summary-card";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { enabledNavFlags } from "@/lib/nav-flags";
import { AppTourLoader } from "@/components/app-tour/app-tour-loader";
import { PageHeader } from "@/components/shared/page-header";
import { DashboardKpis, DashboardKpisSkeleton } from "./components/dashboard-kpis";
import { ActionQueue, ActionQueueSkeleton } from "./components/action-queue";
import { MyDay, MyDaySkeleton } from "./components/my-day";
import { ManagerAttentionWidget, ManagerAttentionWidgetSkeleton } from "./components/manager-attention-widget";
import { HeroOverdueCard, HeroOverdueCardSkeleton } from "./components/hero-overdue-card";
import { PipelineTrendCard, PipelineTrendCardSkeleton } from "./components/pipeline-trend-card";
import { NextBestActionsCard, NextBestActionsCardSkeleton } from "./components/next-best-actions-card";
import { OverdueFollowupsCard, OverdueFollowupsCardSkeleton } from "./components/overdue-followups-card";
import { RmPerformanceCard, RmPerformanceCardSkeleton } from "./components/rm-performance-card";
import { TodaysScheduleCard, TodaysScheduleCardSkeleton } from "./components/todays-schedule-card";
import { SegmentedControl } from "./components/segmented-control";
import { StickyRail, TabbedWorkspace, lazyPanels } from "@/components/workspace";
import { homeTabsFor } from "@/lib/home/tabs";
import { outcomesEnabled } from "@/lib/outcomes/flag";
import { NeedsAttentionCard, NeedsAttentionCardSkeleton } from "@/components/outcomes/needs-attention-card";
import { TodayHome } from "./components/today-home";
import { LazyMotionProvider as MotionProvider } from "@/components/motion/lazy";
import { motionEnabled } from "@/components/motion/tokens";

const RANGE_OPTIONS = [
  { label: "Today", value: "today" },
  { label: "Week", value: "week" },
  { label: "Quarter", value: "quarter" },
];

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string; view?: string; tab?: string | string[] }> }) {
  const session = await requireUser();
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const clientFilter = visibleUserIds ? { assignedToId: { in: visibleUserIds }, isDeleted: false } : { isDeleted: false };
  const taskFilter = visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {};
  const { range: rawRange, view, tab: rawTab } = await searchParams;
  const range = rawRange === "today" || rawRange === "quarter" ? rawRange : "week";

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { hasSeenTour: true },
  });

  // Flag off: a plain fragment, so nothing from the motion library is rendered or loaded.
  const Shell = motionEnabled() ? MotionProvider : Fragment;
  const HOME_V2 = process.env.NEXT_PUBLIC_HOME_V2 === "1";
  const tour = <AppTourLoader role={session.user.role} hasSeenTour={user?.hasSeenTour ?? true} flags={enabledNavFlags()} />;
  if (HOME_V2 && view !== "full" && ["ADMIN", "MANAGER", "RM"].includes(session.user.role)) {
    return (
      <Shell>
        {tour}
        <TodayHome userId={session.user.id} role={session.user.role} visibleUserIds={visibleUserIds} clientFilter={clientFilter} taskFilter={taskFilter} range={range} tab={rawTab} />
      </Shell>
    );
  }

  const role = session.user.role;
  const isTeamRole = role !== "RM";
  const tabs = homeTabsFor(role, "full", { attention: outcomesEnabled() });
  // One fixed-height command layout: the KPI strip stays put, the focus panel shows one tab at a time, the rail holds the next actions.
  // Lazy tabs: only the section for ?tab= is built, so the other tabs' queries never run.
  const builders: Record<string, () => ReactNode> = {
    myday: () => (
      <div className="@container">
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
          <Suspense fallback={<HeroOverdueCardSkeleton className="self-start" />}>
            <HeroOverdueCard taskFilter={taskFilter} className="self-start" />
          </Suspense>
          <Suspense fallback={<TodaysScheduleCardSkeleton />}>
            <TodaysScheduleCard taskFilter={taskFilter} />
          </Suspense>
          <Suspense fallback={<OverdueFollowupsCardSkeleton />}>
            <OverdueFollowupsCard taskFilter={taskFilter} />
          </Suspense>
          <Suspense fallback={<MyDaySkeleton />}>
            <MyDay clientFilter={clientFilter} taskFilter={taskFilter} />
          </Suspense>
        </div>
      </div>
    ),
    pipeline: () => (
      <div className="flex flex-col gap-4">
        <Suspense fallback={<PipelineTrendCardSkeleton />}>
          <PipelineTrendCard clientFilter={clientFilter} range={range} />
        </Suspense>
        <Suspense fallback={<ActionQueueSkeleton />}>
          <ActionQueue taskFilter={taskFilter} />
        </Suspense>
      </div>
    ),
  };
  builders.attention = () => (
    <Suspense fallback={<NeedsAttentionCardSkeleton />}>
      <NeedsAttentionCard visibleUserIds={visibleUserIds} showRm={isTeamRole} />
    </Suspense>
  );
  if (isTeamRole) {
    builders.team = () => (
      <div className="@container">
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
          <Suspense fallback={<RmPerformanceCardSkeleton />}>
            <RmPerformanceCard clientFilter={clientFilter} visibleUserIds={visibleUserIds} />
          </Suspense>
          <Suspense fallback={<ManagerAttentionWidgetSkeleton />}>
            <ManagerAttentionWidget visibleUserIds={visibleUserIds} />
          </Suspense>
        </div>
      </div>
    );
  }
  const panels = lazyPanels(tabs.map((t) => t.key), rawTab, tabs[0].key, builders);

  return (
    <Shell>
      {tour}
      <TabbedWorkspace
        idPrefix="dash"
        label="Dashboard sections"
        tabs={tabs}
        panels={panels}
        lazy
        header={
          <>
            <PageHeader title="Dashboard" description="Today's onboarding activity at a glance." />
            <Suspense fallback={<DashboardKpisSkeleton strip />}>
              <DashboardKpis strip clientFilter={clientFilter} taskFilter={taskFilter} />
            </Suspense>
          </>
        }
        toolbars={{ pipeline: <SegmentedControl options={RANGE_OPTIONS} /> }}
        rail={
          <StickyRail label="Next actions">
            <Suspense fallback={<NextBestActionsCardSkeleton />}>
              <NextBestActionsCard visibleUserIds={visibleUserIds} />
            </Suspense>
            {["ADMIN", "MANAGER", "RM"].includes(role) && <AiSummaryCard kind="my_day" label="Summarize my day" />}
          </StickyRail>
        }
      />
    </Shell>
  );
}
