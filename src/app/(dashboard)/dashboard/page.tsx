import { Suspense } from "react";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { AppTourLoader } from "@/components/app-tour/app-tour-loader";
import { PageHeader } from "@/components/shared/page-header";
import { DashboardKpis, DashboardKpisSkeleton } from "./components/dashboard-kpis";
import { ActionQueue, ActionQueueSkeleton } from "./components/action-queue";
import { MyDay, MyDaySkeleton } from "./components/my-day";
import { ManagerAttentionWidget, ManagerAttentionWidgetSkeleton } from "./components/manager-attention-widget";

export default async function DashboardPage() {
  const session = await requireUser();
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const clientFilter = visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {};
  const taskFilter = visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {};

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { hasSeenTour: true },
  });

  return (
    <div className="flex flex-col gap-6">
      <AppTourLoader role={session.user.role} hasSeenTour={user?.hasSeenTour ?? true} />

      <PageHeader title="Dashboard" description="Today's onboarding activity at a glance." />

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
  );
}
