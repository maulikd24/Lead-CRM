import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NewClientDialog } from "./new-client-dialog";
import { ClientFilters } from "./client-filters";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { computeSlaStatus, stageAgeHours, type SlaStatus } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";
import type { Prisma } from "@/generated/prisma/client";

const PAGE_SIZE = 25;

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ACTIVE: "default",
  ON_HOLD: "secondary",
  COMPLETED: "default",
  NOT_PROCEEDING: "destructive",
};

const PRIORITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  HIGH: "destructive",
  MEDIUM: "secondary",
  LOW: "outline",
};

const SLA_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ON_TRACK: "default",
  DUE_SOON: "secondary",
  OVERDUE: "destructive",
  NOT_APPLICABLE: "outline",
};

type SearchParams = {
  q?: string;
  stage?: string;
  priority?: string;
  sla?: string;
  status?: string;
  rm?: string;
  kyc?: string;
  funding?: string;
  dealer?: string;
  clientType?: string;
  leadSource?: string;
  createdFrom?: string;
  createdTo?: string;
  page?: string;
};

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireUser();
  const params = await searchParams;
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);

  const currentPage = Math.max(1, Number(params.page) || 1);

  let assignedToFilter: Prisma.ClientWhereInput["assignedToId"];
  if (params.rm && (!visibleUserIds || visibleUserIds.includes(params.rm))) {
    assignedToFilter = params.rm;
  } else if (visibleUserIds) {
    assignedToFilter = { in: visibleUserIds };
  }

  const where: Prisma.ClientWhereInput = {
    ...(assignedToFilter !== undefined ? { assignedToId: assignedToFilter } : {}),
    ...(params.stage ? { currentStageId: params.stage } : {}),
    ...(params.priority ? { priority: params.priority as Prisma.ClientWhereInput["priority"] } : {}),
    ...(params.status ? { status: params.status as Prisma.ClientWhereInput["status"] } : {}),
    ...(params.kyc ? { kycRecord: { status: params.kyc as never } } : {}),
    ...(params.funding ? { fundingRecord: { status: params.funding as never } } : {}),
    ...(params.dealer ? { dealerIntroduction: { status: params.dealer as never } } : {}),
    ...(params.clientType ? { clientType: { contains: params.clientType, mode: "insensitive" } } : {}),
    ...(params.leadSource ? { leadSource: { contains: params.leadSource, mode: "insensitive" } } : {}),
    ...(params.createdFrom || params.createdTo
      ? {
          createdAt: {
            ...(params.createdFrom ? { gte: new Date(params.createdFrom) } : {}),
            ...(params.createdTo ? { lte: new Date(`${params.createdTo}T23:59:59.999`) } : {}),
          },
        }
      : {}),
    ...(params.q
      ? {
          OR: [
            { name: { contains: params.q, mode: "insensitive" } },
            { mobile: { contains: params.q, mode: "insensitive" } },
            { email: { contains: params.q, mode: "insensitive" } },
            { clientCode: { contains: params.q, mode: "insensitive" } },
            { kycRecord: { referenceNumber: { contains: params.q, mode: "insensitive" } } },
            { dealerIntroduction: { dealerId: { contains: params.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const include = { assignedTo: true, currentStage: true } as const;
  const orderBy = { createdAt: "desc" as const };

  let pageClients: Prisma.ClientGetPayload<{ include: typeof include }>[];
  let totalCount: number;

  const filtersPromise = Promise.all([
    prisma.stage.findMany({ orderBy: { sequence: "asc" } }),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  if (params.sla) {
    const candidates = await prisma.client.findMany({ where, include, orderBy, take: 500 });
    const exceptions = await prisma.exception.findMany({
      where: { clientId: { in: candidates.map((c) => c.id) } },
      select: { clientId: true, stageId: true, createdAt: true, resolvedAt: true },
    });
    const now = new Date();
    const filtered = candidates.filter((client) => {
      const heldMs = exceptions
        .filter((e) => e.clientId === client.id && e.stageId === client.currentStageId)
        .reduce((sum, e) => sum + Math.max(0, (e.resolvedAt ?? now).getTime() - e.createdAt.getTime()), 0);
      const status = computeSlaStatus(effectiveStageEnteredAt(client.stageEnteredAt, heldMs), client.currentStage.slaHours, now);
      return status === params.sla;
    });
    totalCount = filtered.length;
    pageClients = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  } else {
    [pageClients, totalCount] = await Promise.all([
      prisma.client.findMany({ where, include, orderBy, skip: (currentPage - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      prisma.client.count({ where }),
    ]);
  }

  const pageClientIds = pageClients.map((c) => c.id);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const [[stages, users], exceptionsForPage, nextTasks, lastActivities] = await Promise.all([
    filtersPromise,
    prisma.exception.findMany({
      where: { clientId: { in: pageClientIds } },
      select: { clientId: true, stageId: true, createdAt: true, resolvedAt: true },
    }),
    pageClientIds.length
      ? prisma.task.findMany({
          where: { clientId: { in: pageClientIds }, status: { in: ["PENDING", "OVERDUE"] } },
          orderBy: [{ clientId: "asc" }, { dueAt: "asc" }],
          distinct: ["clientId"],
        })
      : Promise.resolve([]),
    pageClientIds.length
      ? prisma.activity.findMany({
          where: { clientId: { in: pageClientIds } },
          orderBy: [{ clientId: "asc" }, { createdAt: "desc" }],
          distinct: ["clientId"],
        })
      : Promise.resolve([]),
  ]);

  const nextTaskByClient = new Map(nextTasks.map((t) => [t.clientId, t]));
  const lastActivityByClient = new Map(lastActivities.map((a) => [a.clientId, a]));
  const now = new Date();

  function slaStatusFor(client: (typeof pageClients)[number]): SlaStatus {
    const heldMs = exceptionsForPage
      .filter((e) => e.clientId === client.id && e.stageId === client.currentStageId)
      .reduce((sum, e) => sum + Math.max(0, (e.resolvedAt ?? now).getTime() - e.createdAt.getTime()), 0);
    return computeSlaStatus(effectiveStageEnteredAt(client.stageEnteredAt, heldMs), client.currentStage.slaHours, now);
  }

  function buildPageHref(page: number): string {
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key !== "page" && value) usp.set(key, value);
    }
    if (page > 1) usp.set("page", String(page));
    const qs = usp.toString();
    return qs ? `/clients?${qs}` : "/clients";
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Clients</CardTitle>
        <NewClientDialog users={users} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ClientFilters stages={stages} users={users} />
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Stage Age</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Next Action</TableHead>
                <TableHead>Next Action Date</TableHead>
                <TableHead>SLA Status</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned RM</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last Activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageClients.map((client) => {
                const ageHours = stageAgeHours(client.stageEnteredAt);
                const slaStatus = slaStatusFor(client);
                const nextTask = nextTaskByClient.get(client.id);
                const lastActivity = lastActivityByClient.get(client.id);
                return (
                  <TableRow key={client.id}>
                    <TableCell>
                      <Link href={`/clients/${client.id}`} className="font-medium hover:underline">
                        {client.name}
                      </Link>
                      <p className="text-xs text-muted-foreground font-mono">{client.clientCode}</p>
                    </TableCell>
                    <TableCell className="text-sm">{client.mobile}</TableCell>
                    <TableCell className="text-sm">{client.currentStage.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {ageHours < 24 ? `${Math.round(ageHours)}h` : `${Math.round(ageHours / 24)}d`}
                    </TableCell>
                    <TableCell>
                      <Badge variant={PRIORITY_VARIANT[client.priority]}>{client.priority}</Badge>
                    </TableCell>
                    <TableCell className="text-sm max-w-40 truncate">{nextTask?.title ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {nextTask ? formatDateTime(nextTask.dueAt) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={SLA_VARIANT[slaStatus]}>{slaStatus.replace(/_/g, " ")}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[client.status]}>{client.status.replace(/_/g, " ")}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{client.assignedTo?.name ?? "Unassigned"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{formatDate(client.createdAt)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {lastActivity ? formatDateTime(lastActivity.createdAt) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
              {pageClients.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                    No clients match these filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <p>
            {totalCount === 0 ? "0 clients" : `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, totalCount)} of ${totalCount}`}
          </p>
          <div className="flex gap-2">
            {currentPage <= 1 ? (
              <Button size="sm" variant="outline" disabled>
                Previous
              </Button>
            ) : (
              <Button size="sm" variant="outline" render={<Link href={buildPageHref(currentPage - 1)} />}>
                Previous
              </Button>
            )}
            {currentPage >= totalPages ? (
              <Button size="sm" variant="outline" disabled>
                Next
              </Button>
            ) : (
              <Button size="sm" variant="outline" render={<Link href={buildPageHref(currentPage + 1)} />}>
                Next
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
