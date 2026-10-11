import { prisma } from "@/lib/db/prisma";
import { KpiStrip, KpiTile } from "@/components/workspace";
import { KpiTileSkeleton } from "@/components/shared/skeletons";
import { enabledNavFlags } from "@/lib/nav-flags";
import { actionTiles, type ActionCounts } from "@/lib/home/action-tiles";
import { getNavCounts } from "@/lib/wow/nav-counts";
import { getServiceQueue } from "@/lib/service/read";
import type { Prisma, Role } from "@/generated/prisma/client";

/** Today's first row: what needs the person (approvals, overdue work, late promises, open complaints, due today), each linking to where it is handled. */
export async function ActionStrip({ role, userId, taskFilter }: { role: Role; userId: string; taskFilter: Prisma.TaskWhereInput }) {
  const flags = enabledNavFlags();
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const [navCounts, dueToday, service, overdue] = await Promise.all([
    getNavCounts(userId, role),
    prisma.task.count({ where: { ...taskFilter, status: "PENDING", dueAt: { gte: start, lt: new Date(start.getTime() + 86400000) }, client: { isDeleted: false } } }),
    flags.includes("service-state") ? getServiceQueue({ userId, role }, now) : Promise.resolve(null),
    prisma.task.count({ where: { ...taskFilter, status: { in: ["PENDING", "OVERDUE"] }, dueAt: { lt: now }, client: { isDeleted: false } } }),
  ]);
  const counts: ActionCounts = { approvals: navCounts["/approvals"] ?? 0, overdue, dueToday, openComplaints: service?.complaints.length ?? 0, latePromises: service?.commitments.length ?? 0 };
  const tiles = actionTiles(role, flags, counts);
  if (tiles.length === 0) return null;
  return (
    <KpiStrip label="What needs you">
      {tiles.map((t, i) => (
        <KpiTile key={t.key} label={t.label} index={i} tone={t.tone} href={t.href}>
          {t.value}
        </KpiTile>
      ))}
    </KpiStrip>
  );
}

export function ActionStripSkeleton() {
  return (
    <div aria-hidden className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <KpiTileSkeleton key={i} />
      ))}
    </div>
  );
}
