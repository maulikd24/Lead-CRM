import { Fragment, Suspense } from "react";
import { AiSummaryCard } from "@/components/ai-summary-card";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
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
import { TodayHome } from "./components/today-home";
import { LazyMotionProvider as MotionProvider } from "@/components/motion/lazy";
import { motionEnabled } from "@/components/motion/tokens";

const RANGE_OPTIONS = [
  { label: "Today", value: "today" },
  { label: "Week", value: "week" },
  { label: "Quarter", value: "quarter" },
];

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string; view?: string }> }) {
  const session = await requireUser();
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const clientFilter = visibleUserIds ? { assignedToId: { in: visibleUserIds }, isDeleted: false } : { isDeleted: false };
  const taskFilter = visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {};
  const { range: rawRange, view } = await searchParams;
  const range = rawRange === "today" || rawRange === "quarter" ? rawRange : "week";

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { hasSeenTour: true },
  });

  // Flag off: a plain fragment, so nothing from the motion library is rendered or loaded.
  const Shell = motionEnabled() ? MotionProvider : Fragment;
  const HOME_V2 = process.env.NEXT_PUBLIC_HOME_V2 === "1";
  if (HOME_V2 && view !== "full" && ["ADMIN", "MANAGER", "RM"].includes(session.user.role)) {
    return (
      <Shell>
      <div className="flex flex-col gap-6">
        <AppTourLoader role={session.user.role} hasSeenTour={user?.hasSeenTour ?? true} />
        <PageHeader title="Today" description="Who to contact, why, and what to do." />
        <TodayHome userId={session.user.id} role={session.user.role} visibleUserIds={visibleUserIds} clientFilter={clientFilter} taskFilter={taskFilter} />
      </div>
      </Shell>
    );
  }

  return (
    <Shell>
    <div className="flex flex-col gap-6">
      <AppTourLoader role={session.user.role} hasSeenTour={user?.hasSeenTour ?? true} />

      <PageHeader
        title="Dashboard"
        description="Today's onboarding activity at a glance."
        actions={<SegmentedControl options={RANGE_OPTIONS} />}
      />

      {(session.user.role === "ADMIN" || session.user.role === "MANAGER" || session.user.role === "RM") && (
        <AiSummaryCard kind="my_day" label="Summarize my day" />
      )}

      <div className="grid grid-cols-12 gap-4">
        <Suspense fallback={<HeroOverdueCardSkeleton className="col-span-12 lg:col-span-4" />}>
          <HeroOverdueCard taskFilter={taskFilter} className="col-span-12 lg:col-span-4" />
        </Suspense>
        <Suspense fallback={<PipelineTrendCardSkeleton className="col-span-12 lg:col-span-8" />}>
          <PipelineTrendCard clientFilter={clientFilter} range={range} className="col-span-12 lg:col-span-8" />
        </Suspense>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <Suspense fallback={<NextBestActionsCardSkeleton className="col-span-12 lg:col-span-6" />}>
          <NextBestActionsCard visibleUserIds={visibleUserIds} className="col-span-12 lg:col-span-6" />
        </Suspense>
        <Suspense fallback={<OverdueFollowupsCardSkeleton className="col-span-12 lg:col-span-6" />}>
          <OverdueFollowupsCard taskFilter={taskFilter} className="col-span-12 lg:col-span-6" />
        </Suspense>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {session.user.role !== "RM" && (
          <Suspense fallback={<RmPerformanceCardSkeleton className="col-span-12 lg:col-span-6" />}>
            <RmPerformanceCard clientFilter={clientFilter} visibleUserIds={visibleUserIds} className="col-span-12 lg:col-span-6" />
          </Suspense>
        )}
        <Suspense fallback={<TodaysScheduleCardSkeleton className={session.user.role !== "RM" ? "col-span-12 lg:col-span-6" : "col-span-12"} />}>
          <TodaysScheduleCard taskFilter={taskFilter} className={session.user.role !== "RM" ? "col-span-12 lg:col-span-6" : "col-span-12"} />
        </Suspense>
      </div>

      <Suspense fallback={<MyDaySkeleton />}>
        <MyDay clientFilter={clientFilter} taskFilter={taskFilter} />
      </Suspense>

      {session.user.role !== "RM" && (
        <Suspense fallback={<ManagerAttentionWidgetSkeleton />}>
          <ManagerAttentionWidget visibleUserIds={visibleUserIds} />
        </Suspense>
      )}

      <Suspense fallback={<DashboardKpisSkeleton />}>
        <DashboardKpis clientFilter={clientFilter} taskFilter={taskFilter} />
      </Suspense>

      <Suspense fallback={<ActionQueueSkeleton />}>
        <ActionQueue taskFilter={taskFilter} />
      </Suspense>
    </div>
    </Shell>
  );
}
