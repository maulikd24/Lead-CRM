import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { buildUserEventWhere, type ActivityLogParams } from "@/lib/activity/query";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserEventTable } from "@/components/activity/user-event-table";
import { ActivityFilters } from "./activity-filters";

const PAGE_SIZE = 50;

type SearchParams = ActivityLogParams & { page?: string };

export default async function ActivityLogPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const params = await searchParams;
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);

  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const where = buildUserEventWhere(params, visibleUserIds);
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const scope = buildUserEventWhere({}, visibleUserIds);

  const [rows, total, users, loginsToday, failed24h, activeUsers24h] = await Promise.all([
    prisma.userEvent.findMany({
      where,
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.userEvent.count({ where }),
    prisma.user.findMany({
      where: visibleUserIds ? { id: { in: visibleUserIds } } : {},
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.userEvent.count({ where: { ...scope, type: "LOGIN_SUCCESS", createdAt: { gte: since24h } } }),
    prisma.userEvent.count({ where: { ...scope, type: "LOGIN_FAILED", createdAt: { gte: since24h } } }),
    prisma.userEvent.findMany({ where: { ...scope, createdAt: { gte: since24h }, userId: { not: null } }, distinct: ["userId"], select: { userId: true } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") qs.set(k, v);
    qs.set("page", String(p));
    return `/activity-log?${qs.toString()}`;
  };
  const exportQs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v && k !== "page") exportQs.set(k, v);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Activity Log"
        description={
          session.user.role === "ADMIN"
            ? "Sign-ins, page views, downloads and every change made by every user."
            : "Sign-ins, page views, downloads and every change made by your team."
        }
        actions={
          <Button variant="outline" size="sm" render={<Link href={`/api/activity-log/export?${exportQs.toString()}`} />}>
            Download CSV
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Sign-ins (24h)" value={loginsToday} />
        <StatCard label="Active users (24h)" value={activeUsers24h.length} />
        <StatCard label="Failed sign-ins (24h)" value={failed24h} tone={failed24h > 0 ? "warning" : "default"} />
      </div>

      <ActivityFilters users={users} />

      <Card>
        <CardContent>
          <UserEventTable rows={rows} />
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {total.toLocaleString("en-IN")} event{total === 1 ? "" : "s"} · page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} render={<Link href={pageHref(page - 1)} />}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} render={<Link href={pageHref(page + 1)} />}>
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
