import { Suspense } from "react";
import Link from "next/link";

import type { Prisma, Role } from "@/generated/prisma/client";
import { homeModulesFor, homeSpansFor, type HomeModule } from "@/lib/home/modules";
import { HeroOverdueCard, HeroOverdueCardSkeleton } from "./hero-overdue-card";
import { NextBestActionsCard, NextBestActionsCardSkeleton } from "./next-best-actions-card";
import { TodaysScheduleCard, TodaysScheduleCardSkeleton } from "./todays-schedule-card";
import { RmPerformanceCard, RmPerformanceCardSkeleton } from "./rm-performance-card";
import { motionEnabled } from "@/components/motion/tokens";
import { PageTransition } from "@/components/motion/page-transition";
import { FadeIn } from "@/components/motion/fade-in";
import { LiveFunnelSection } from "./live-funnel-section";
import { LiveFunnelSkeleton } from "./live-funnel";
import { DashboardKpis, DashboardKpisSkeleton } from "./dashboard-kpis";
import { ManagerAttentionWidget, ManagerAttentionWidgetSkeleton } from "./manager-attention-widget";

// Literal class names so Tailwind can see them.
const LG_SPAN: Record<number, string> = {
  3: "col-span-12 lg:col-span-3",
  4: "col-span-12 lg:col-span-4",
  6: "col-span-12 lg:col-span-6",
  12: "col-span-12",
};

type Props = {
  role: Role;
  visibleUserIds: string[] | null;
  clientFilter: Prisma.ClientWhereInput;
  taskFilter: Prisma.TaskWhereInput;
  userId?: string;
};

export function TodayHome({ role, visibleUserIds, clientFilter, taskFilter, userId }: Props) {
  const motion = motionEnabled() && !!userId && ["ADMIN", "MANAGER", "RM"].includes(role);
  const spans = homeSpansFor(role);
  const render = (module: HomeModule) => {
    const span = LG_SPAN[spans[module]];
    switch (module) {
      case "needsYouNow":
        return (
          <Suspense key={module} fallback={<HeroOverdueCardSkeleton className={span} />}>
            <HeroOverdueCard taskFilter={taskFilter} className={span} />
          </Suspense>
        );
      case "todayQueue":
        return (
          <Suspense key={module} fallback={<NextBestActionsCardSkeleton className={span} />}>
            <NextBestActionsCard visibleUserIds={visibleUserIds} className={span} />
          </Suspense>
        );
      case "schedule":
        return (
          <Suspense key={module} fallback={<TodaysScheduleCardSkeleton className={span} />}>
            <TodaysScheduleCard taskFilter={taskFilter} className={span} />
          </Suspense>
        );
      case "teamPulse":
        return (
          <Suspense key={module} fallback={<RmPerformanceCardSkeleton className={span} />}>
            <RmPerformanceCard clientFilter={clientFilter} visibleUserIds={visibleUserIds} className={span} />
          </Suspense>
        );
      case "managerAttention":
        return (
          <div key={module} className={span}>
            <Suspense fallback={<ManagerAttentionWidgetSkeleton />}>
              <ManagerAttentionWidget visibleUserIds={visibleUserIds} />
            </Suspense>
          </div>
        );
    }
  };

  if (motion) {
    return (
      <PageTransition className="flex flex-col gap-4">
        <Suspense fallback={<LiveFunnelSkeleton />}>
          <LiveFunnelSection role={role} userId={userId} visibleUserIds={visibleUserIds} />
        </Suspense>
        <Suspense fallback={<DashboardKpisSkeleton />}>
          <DashboardKpis clientFilter={clientFilter} taskFilter={taskFilter} />
        </Suspense>
        <FadeIn delay={0.15} className="grid grid-cols-12 gap-4">
          {homeModulesFor(role).map(render)}
        </FadeIn>
        <Link href="/dashboard?view=full" className="self-start text-sm text-muted-foreground hover:text-foreground">
          Full overview
        </Link>
      </PageTransition>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-12 gap-4">{homeModulesFor(role).map(render)}</div>
      <Link href="/dashboard?view=full" className="self-start text-sm text-muted-foreground hover:text-foreground">
        Full overview
      </Link>
    </div>
  );
}
