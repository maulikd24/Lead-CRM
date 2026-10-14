import { Suspense, type ReactNode } from "react";
import Link from "next/link";

import type { Prisma, Role } from "@/generated/prisma/client";
import { homeModulesFor } from "@/lib/home/modules";
import { homeTabsFor, myDayTaskFilter } from "@/lib/home/tabs";
import { PageHeader } from "@/components/shared/page-header";
import { PhoneSheet, StickyRail, TabbedWorkspace, lazyPanels } from "@/components/workspace";
import { motionEnabled } from "@/components/motion/tokens";
import { OverdueFollowupsCard, OverdueFollowupsCardSkeleton } from "./overdue-followups-card";
import { NextBestActionsCard, NextBestActionsCardSkeleton } from "./next-best-actions-card";
import { TodaysScheduleCard, TodaysScheduleCardSkeleton } from "./todays-schedule-card";
import { RmPerformanceCard, RmPerformanceCardSkeleton } from "./rm-performance-card";
import { PipelineTrendCard, PipelineTrendCardSkeleton } from "./pipeline-trend-card";
import { LiveFunnelSection } from "./live-funnel-section";
import { LiveFunnelSkeleton } from "./live-funnel-skeleton";
import { ActionStrip, ActionStripSkeleton } from "./action-strip";
import { ManagerAttentionWidget, ManagerAttentionWidgetSkeleton } from "./manager-attention-widget";
import { SegmentedControl } from "./segmented-control";
import { outcomesEnabled } from "@/lib/outcomes/flag";
import { NeedsAttentionSkeleton } from "@/components/attention/needs-attention-feed";
import { attentionEngineEnabled } from "@/lib/attention/flag";
import { NeedsAttentionSection } from "./needs-attention-section";
import { NeedsAttentionCard, NeedsAttentionCardSkeleton } from "@/components/outcomes/needs-attention-card";

type Props = {
  role: Role;
  visibleUserIds: string[] | null;
  clientFilter: Prisma.ClientWhereInput;
  taskFilter: Prisma.TaskWhereInput;
  userId?: string;
  range?: string;
  /** `?tab=` as the page received it: only that section is built (lazy tabs). */
  tab?: string | string[];
};

const RANGE_OPTIONS = [
  { label: "Today", value: "today" },
  { label: "Week", value: "week" },
  { label: "Quarter", value: "quarter" },
];

/**
 * Today home as the Command Centre: the action strip (approvals, overdue work, promises, complaints) stays put, one focus panel shows one tab at a time (My day for an
 * RM, Team for a manager or admin, and the Pipeline), and the rail keeps the prioritised next actions in view. Which cards sit
 * in which tab follows `homeModulesFor`, so a role never gets a card it did not have before.
 */
export function TodayHome({ role, visibleUserIds, clientFilter, taskFilter, userId, range = "week", tab }: Props) {
  const live = motionEnabled() && !!userId && ["ADMIN", "MANAGER", "RM"].includes(role);
  const modules = homeModulesFor(role);
  const tabs = homeTabsFor(role, "today", { attention: outcomesEnabled(), feed: attentionEngineEnabled() });

  // An RM's cards follow their modules. A manager or admin has a My day tab too: the same two cards, on their own tasks only.
  const ownTasks = userId ? myDayTaskFilter(role, userId, taskFilter) : taskFilter;
  const isDeskLead = role === "MANAGER" || role === "ADMIN";
  const myDay = () => (
    <div className="@container">
      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
        {(isDeskLead || modules.includes("needsYouNow")) && (
          // The action strip above already counts overdue tasks, so this card lists them instead of repeating the number.
          <Suspense fallback={<OverdueFollowupsCardSkeleton className="self-start" />}>
            <OverdueFollowupsCard taskFilter={ownTasks} className="self-start" />
          </Suspense>
        )}
        {(isDeskLead || modules.includes("schedule")) && (
          <Suspense fallback={<TodaysScheduleCardSkeleton />}>
            <TodaysScheduleCard taskFilter={ownTasks} />
          </Suspense>
        )}
      </div>
    </div>
  );
  const team = () => (
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
  const pipeline = () => live ? (
    <div className="flex flex-col gap-4">
      <Suspense fallback={<PipelineTrendCardSkeleton />}>
        <PipelineTrendCard clientFilter={clientFilter} range={range} />
      </Suspense>
      <Suspense fallback={<LiveFunnelSkeleton />}>
        <LiveFunnelSection part="funnel" role={role} userId={userId!} visibleUserIds={visibleUserIds} />
      </Suspense>
    </div>
  ) : (
    <Suspense fallback={<PipelineTrendCardSkeleton />}>
      <PipelineTrendCard clientFilter={clientFilter} range={range} />
    </Suspense>
  );

  // Customer outcomes (flag NEXT_PUBLIC_OUTCOMES): customers who need attention today, scoped to the viewer like every other card here.
  const attention = () => (
    <Suspense fallback={<NeedsAttentionCardSkeleton />}>
      <NeedsAttentionCard visibleUserIds={visibleUserIds} showRm={isDeskLead} />
    </Suspense>
  );
  // Attention Engine v1 (flag NEXT_PUBLIC_ATTENTION_ENGINE): the ranked, role-scoped feed. Absent from the tab list when the flag is off.
  const feed = () => (
    <Suspense fallback={<NeedsAttentionSkeleton />}>
      <NeedsAttentionSection userId={userId ?? ""} role={role} />
    </Suspense>
  );
  const panels = lazyPanels(tabs.map((t) => t.key), tab, tabs[0].key, { myday: myDay, team, pipeline, attention, feed } as Record<string, () => ReactNode>);

  return (
    <>
      <TabbedWorkspace
        idPrefix="today"
        label="Today sections"
        tabs={tabs}
        panels={panels}
        lazy
        header={
          <>
            <PageHeader
              title="Today"
              description="What needs you now: approvals, overdue work, promises and complaints, then who to contact."
              actions={
                <Link href="/dashboard?view=full" className="text-sm text-muted-foreground hover:text-foreground">
                  Full overview
                </Link>
              }
            />
            <Suspense fallback={<ActionStripSkeleton />}>
              <ActionStrip role={role} userId={userId ?? ""} taskFilter={taskFilter} />
            </Suspense>
          </>
        }
        toolbars={{ pipeline: <SegmentedControl options={RANGE_OPTIONS} /> }}
        rail={
          <StickyRail label="Next actions">
            {modules.includes("todayQueue") && (
              <PhoneSheet name="next-actions" title="Next best actions" summary="Prioritised for you, with who to start with">
                <Suspense fallback={<NextBestActionsCardSkeleton />}>
                  <NextBestActionsCard visibleUserIds={visibleUserIds} role={role} userId={userId ?? ""} />
                </Suspense>
              </PhoneSheet>
            )}
          </StickyRail>
        }
      />
    </>
  );
}
