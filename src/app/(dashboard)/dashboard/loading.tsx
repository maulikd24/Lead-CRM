import { DashboardKpisSkeleton } from "./components/dashboard-kpis";
import { ActionQueueSkeleton } from "./components/action-queue";

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-4">
      <DashboardKpisSkeleton />
      <ActionQueueSkeleton />
    </div>
  );
}
