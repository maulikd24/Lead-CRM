import { Suspense, type ReactNode } from "react";
import Link from "next/link";

import type { Prisma, Role } from "@/generated/prisma/client";
import { homeModulesFor } from "@/lib/home/modules";
import { homeTabsFor } from "@/lib/home/tabs";
import { PageHeader } from "@/components/shared/page-header";
import { StickyRail, TabbedWorkspace } from "@/components/workspace";
import { motionEnabled } from "@/components/motion/tokens";
import { HeroOverdueCard, HeroOverdueCardSkeleton } from "./hero-overdue-card";
import { NextBestActionsCard, NextBestActionsCardSkeleton } from "./next-best-actions-card";
import { TodaysScheduleCard, TodaysScheduleCardSkeleton } from "./todays-schedule-card";
import { RmPerformanceCard, RmPerformanceCardSkeleton } from "./rm-performance-card";
import { PipelineTrendCard, PipelineTrendCardSkeleton } from "./pipeline-trend-card";
import { LiveFunnelSection } from "./live-funnel-section";
import { LiveFunnelSkeleton } from "./live-funnel-skeleton";
import { DashboardKpis, DashboardKpisSkeleton } from "./dashboard-kpis";
import { ManagerAttentionWidget, ManagerAttentionWidgetSkeleton } from "./manager-attention-widget";
import { SegmentedControl } from "./segmented-control";

type Props = {
  role: Role;
  visibleUserIds: string[] | null;
  clientFilter: Prisma.ClientWhereInput;
  taskFilter: Prisma.TaskWhereInput;
  userId?: string;
  range?: string;
};

const RANGE_OPTIONS = [
  { label: "Today", value: "today" },
  { label: "Week", value: "week" },
  { label: "Quarter", value: "quarter" },
];

/**
 * Today home as a fixed-height command layout: the KPI strip stays put, one focus panel shows one tab at a time (My day for an
 * RM, Team for a manager or admin, and the Pipeline), and the rail keeps the prioritised next actions in view. Which cards sit
 * in which tab follows `homeModulesFor`, so a role never gets a card it did not have before.
 */
export function TodayHome({ role, visibleUserIds, clientFilter, taskFilter, userId, range = "week" }: Props) {
  const live = motionEnabled() && !!userId && ["ADMIN", "MANAGER", "RM"].includes(role);
  const modules = homeModulesFor(role);
  const tabs = homeTabsFor(role, "today");

  const myDay = (
    <div className="@container">
      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
        {modules.includes("needsYouNow") && (
          <Suspense fallback={<HeroOverdueCardSkeleton className="self-start" />}>
            <HeroOverdueCard taskFilter={taskFilter} className="self-start" />
          </Suspense>
        )}
        {modules.includes("schedule") && (
          <Suspense fallback={<TodaysScheduleCardSkeleton />}>
            <TodaysScheduleCard taskFilter={taskFilter} />
          </Suspense>
        )}
      </div>
    </div>
  );
  const team = (
    <div className="@container">
      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
        {modules.includes("teamPulse") && (
          <Suspense fallback={<RmPerformanceCardSkeleton />}>
            <RmPerformanceCard clientFilter={clientFilter} visibleUserIds={visibleUserIds} />
          </Suspense>
        )}
        {modules.includes("managerAttention") && (
          <Suspense fallback={<ManagerAttentionWidgetSkeleton />}>
            <ManagerAttentionWidget visibleUserIds={visibleUserIds} />
          </Suspense>
        )}
      </div>
    </div>
  );
  const pipeline = live ? (
    <Suspense fallback={<LiveFunnelSkeleton />}>
      <LiveFunnelSection part="funnel" role={role} userId={userId!} visibleUserIds={visibleUserIds} />
    </Suspense>
  ) : (
    <Suspense fallback={<PipelineTrendCardSkeleton />}>
      <PipelineTrendCard clientFilter={clientFilter} range={range} />
    </Suspense>
  );

  const panels: Record<string, ReactNode> = { myday: myDay, team, pipeline };

  return (
    <>
      <TabbedWorkspace
        idPrefix="today"
        label="Today sections"
        tabs={tabs}
        panels={panels}
        header={
          <>
            <PageHeader
              title="Today"
              description="Who to contact, why, and what to do."
              actions={
                <Link href="/dashboard?view=full" className="text-sm text-muted-foreground hover:text-foreground">
                  Full overview
                </Link>
              }
            />
            <Suspense fallback={<DashboardKpisSkeleton strip />}>
              <DashboardKpis strip clientFilter={clientFilter} taskFilter={taskFilter} />
            </Suspense>
          </>
        }
        toolbars={live ? undefined : { pipeline: <SegmentedControl options={RANGE_OPTIONS} /> }}
        rail={
          <StickyRail label="Next actions">
            {modules.includes("todayQueue") && (
              <Suspense fallback={<NextBestActionsCardSkeleton />}>
                <NextBestActionsCard visibleUserIds={visibleUserIds} />
              </Suspense>
            )}
          </StickyRail>
        }
      />
      {live && (
        <Suspense fallback={null}>
          <LiveFunnelSection part="celebration" role={role} userId={userId!} visibleUserIds={visibleUserIds} />
        </Suspense>
      )}
    </>
  );
}
