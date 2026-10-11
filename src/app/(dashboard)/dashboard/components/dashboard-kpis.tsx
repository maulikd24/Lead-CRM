import { Users, UserPlus, Clock, AlertCircle, FileCheck, Wallet, Handshake, CheckCircle2 } from "lucide-react";

import { prisma } from "@/lib/db/prisma";
import { StatCard, type StatTone } from "@/components/shared/stat-card";
import { KpiTileSkeleton } from "@/components/shared/skeletons";
import type { Prisma } from "@/generated/prisma/client";
import { motionEnabled } from "@/components/motion/tokens";
import { LazyStagger as Stagger, LazyStaggerItem as StaggerItem } from "@/components/motion/lazy";
import { dailyCounts } from "@/lib/dashboard/daily-counts";
import { LazySparkline as Sparkline } from "./lazy-parts";
import { KpiCard, KpiCardSkeleton } from "@/components/wow";
import { KpiLeadStrip } from "@/components/wow/kpi-lead-strip";
import { computeDelta, trailingWindows } from "@/components/wow/wow-logic";
import { clientHistory } from "@/lib/wow/history";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const TILE_HREF: Record<string, string> = { "Due Today": "/tasks" };

/** `strip`: one compact row that stays above the tabs (the command layout). Otherwise the original grid of stat cards. */
export async function DashboardKpis({ clientFilter, taskFilter, strip = false }: { clientFilter: Prisma.ClientWhereInput; taskFilter: Prisma.TaskWhereInput; strip?: boolean }) {
  const today = startOfToday();
  const now = new Date();

  const [activeClients, newToday, completedClients, dueToday, overdueTasks, kycPending, fundingPending, dealerPending] =
    await Promise.all([
      prisma.client.count({ where: { ...clientFilter, status: "ACTIVE" } }),
      prisma.client.count({ where: { ...clientFilter, createdAt: { gte: today } } }),
      prisma.client.count({ where: { ...clientFilter, status: "COMPLETED" } }),
      prisma.task.count({ where: { ...taskFilter, status: "PENDING", dueAt: { gte: today, lt: new Date(today.getTime() + 86400000) }, client: { isDeleted: false } } }),
      prisma.task.count({ where: { ...taskFilter, status: { in: ["PENDING", "OVERDUE"] }, dueAt: { lt: now }, client: { isDeleted: false } } }),
      prisma.kycRecord.count({ where: { status: "PENDING", client: clientFilter } }),
      prisma.fundingRecord.count({ where: { status: "PENDING", client: clientFilter } }),
      prisma.dealerIntroduction.count({ where: { status: "PENDING", client: clientFilter } }),
    ]);

  const tiles: { label: string; value: number; icon: typeof Users; tone: StatTone }[] = [
    { label: "Active Clients", value: activeClients, icon: Users, tone: "default" },
    { label: "New Today", value: newToday, icon: UserPlus, tone: "default" },
    { label: "Due Today", value: dueToday, icon: Clock, tone: "default" },
    { label: "Overdue", value: overdueTasks, icon: AlertCircle, tone: "destructive" },
    { label: "KYC Pending", value: kycPending, icon: FileCheck, tone: "default" },
    { label: "Funding Pending", value: fundingPending, icon: Wallet, tone: "default" },
    { label: "Dealer Intro Pending", value: dealerPending, icon: Handshake, tone: "default" },
    { label: "Completed", value: completedClients, icon: CheckCircle2, tone: "success" },
  ];

  if (strip) {
    // Real history of the same figures (clients created and completed, last 14 days, for the clients this viewer can see). The pending
    // and due counts have no stored history, so those cards show their number and nothing else rather than an invented trend.
    const history = await clientHistory(clientFilter, 14, now);
    const weekly = (s: number[]) => { const w = trailingWindows(s, 7); return w ? computeDelta(w.current, w.previous) : null; };
    const extra: Record<string, { series?: number[]; delta?: ReturnType<typeof computeDelta>; seriesLabel?: string; deltaLabel?: string }> = {
      "New Today": { series: history.created, delta: weekly(history.created), seriesLabel: `New clients per day, last 14 days: ${history.created.join(", ")}`, deltaLabel: "7d vs prior 7d" },
      Completed: { series: history.completedTotal, delta: weekly(history.completed), seriesLabel: `Completed clients, last 14 days, from ${history.completedTotal[0]} to ${history.completedTotal[13]}`, deltaLabel: "7d vs prior 7d" },
    };
    // One lead figure (what is on your plate today), two supporting cards, then a compact row. Overdue is deliberately NOT repeated here:
    // it has one home (the red card on My day) and a badge on Tasks in the sidebar.
    const by = (label: string) => tiles.find((t) => t.label === label)!;
    const card = (label: string, i: number, size?: "lead" | "compact") => {
      const tile = by(label);
      return <KpiCard key={label} label={tile.label} icon={size === "compact" ? undefined : tile.icon} tone={size === "compact" ? "default" : tile.tone} href={TILE_HREF[label]} index={i} value={tile.value} size={size} hint={size === "lead" ? "follow-ups due before midnight" : undefined} {...(size === "compact" ? {} : extra[label])} />;
    };
    return (
      <KpiLeadStrip
        lead={card("Due Today", 0, "lead")}
        support={[card("New Today", 1), card("Active Clients", 2)]}
        compact={[card("KYC Pending", 3, "compact"), card("Funding Pending", 4, "compact"), card("Dealer Intro Pending", 5, "compact"), card("Completed", 6, "compact")]}
      />
    );
  }

  if (motionEnabled()) {
    const recent = await prisma.client.findMany({ where: { ...clientFilter, createdAt: { gte: new Date(today.getTime() - 6 * 86400000) } }, select: { createdAt: true } });
    const newTrend = dailyCounts(recent.map((r) => r.createdAt), 7, now);
    return (
      <Stagger className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((tile) => (
          <StaggerItem key={tile.label}>
            <StatCard label={tile.label} value={tile.value} icon={tile.icon} tone={tile.tone} animated accessory={tile.label === "New Today" ? <Sparkline values={newTrend} /> : undefined} />
          </StaggerItem>
        ))}
      </Stagger>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((tile) => (
        <StatCard key={tile.label} label={tile.label} value={tile.value} icon={tile.icon} tone={tile.tone} />
      ))}
    </div>
  );
}

export function DashboardKpisSkeleton({ strip = false }: { strip?: boolean }) {
  if (strip) {
    return (
      <KpiLeadStrip
        label="Loading key figures"
        lead={<KpiCardSkeleton lead />}
        support={[<KpiCardSkeleton key="a" />, <KpiCardSkeleton key="b" />]}
        compact={Array.from({ length: 4 }).map((_, i) => (
          <KpiCardSkeleton key={i} compact />
        ))}
      />
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <KpiTileSkeleton key={i} />
      ))}
    </div>
  );
}
