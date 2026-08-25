import { Suspense } from "react";

import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { DashboardKpis, DashboardKpisSkeleton } from "./components/dashboard-kpis";
import { ActionQueue, ActionQueueSkeleton } from "./components/action-queue";

export default async function DashboardPage() {
  const session = await requireUser();
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const clientFilter = visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {};
  const taskFilter = visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {};

  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={<DashboardKpisSkeleton />}>
        <DashboardKpis clientFilter={clientFilter} taskFilter={taskFilter} />
      </Suspense>

      <Suspense fallback={<ActionQueueSkeleton />}>
        <ActionQueue taskFilter={taskFilter} />
      </Suspense>
    </div>
  );
}
