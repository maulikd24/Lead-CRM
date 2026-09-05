import { Users, UserPlus, Clock, AlertCircle, FileCheck, Wallet, Handshake, CheckCircle2 } from "lucide-react";

import { prisma } from "@/lib/db/prisma";
import { StatCard, type StatTone } from "@/components/shared/stat-card";
import { KpiTileSkeleton } from "@/components/shared/skeletons";
import type { Prisma } from "@/generated/prisma/client";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function DashboardKpis({ clientFilter, taskFilter }: { clientFilter: Prisma.ClientWhereInput; taskFilter: Prisma.TaskWhereInput }) {
  const today = startOfToday();
  const now = new Date();

  const [activeClients, newToday, completedClients, dueToday, overdueTasks, kycPending, fundingPending, dealerPending] =
    await Promise.all([
      prisma.client.count({ where: { ...clientFilter, status: "ACTIVE" } }),
      prisma.client.count({ where: { ...clientFilter, createdAt: { gte: today } } }),
      prisma.client.count({ where: { ...clientFilter, status: "COMPLETED" } }),
      prisma.task.count({ where: { ...taskFilter, status: "PENDING", dueAt: { gte: today, lt: new Date(today.getTime() + 86400000) } } }),
      prisma.task.count({ where: { ...taskFilter, status: { in: ["PENDING", "OVERDUE"] }, dueAt: { lt: now } } }),
      prisma.kycRecord.count({ where: { status: "PENDING", client: clientFilter } }),
      prisma.fundingRecord.count({ where: { status: "PENDING", client: clientFilter } }),
      prisma.dealerIntroduction.count({ where: { status: "PENDING", client: clientFilter } }),
    ]);

  const tiles: { label: string; value: number; icon: typeof Users; tone: StatTone }[] = [
    { label: "Active Clients", value: activeClients, icon: Users, tone: "default" },
    { label: "New Today", value: newToday, icon: UserPlus, tone: "default" },
    { label: "Due Today", value: dueToday, icon: Clock, tone: "warning" },
    { label: "Overdue", value: overdueTasks, icon: AlertCircle, tone: "destructive" },
    { label: "KYC Pending", value: kycPending, icon: FileCheck, tone: "default" },
    { label: "Funding Pending", value: fundingPending, icon: Wallet, tone: "default" },
    { label: "Dealer Intro Pending", value: dealerPending, icon: Handshake, tone: "default" },
    { label: "Completed", value: completedClients, icon: CheckCircle2, tone: "success" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((tile) => (
        <StatCard key={tile.label} label={tile.label} value={tile.value} icon={tile.icon} tone={tile.tone} />
      ))}
    </div>
  );
}

export function DashboardKpisSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <KpiTileSkeleton key={i} />
      ))}
    </div>
  );
}
