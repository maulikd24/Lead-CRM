import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NewClientDialog } from "./new-client-dialog";
import { ClientFilters } from "./client-filters";
import { ClientRow } from "./client-row";
import { ClientsBulkSelection, ClientSelectAllHeader } from "./clients-bulk-selection";
import { BulkImportDialog } from "./bulk-import-dialog";
import { computeSlaStatus, stageAgeHours, type SlaStatus } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";
import { buildClientWhere, type ClientFilterParams } from "@/lib/clients/build-client-where";
import type { Prisma } from "@/generated/prisma/client";

const PAGE_SIZE = 25;

type SearchParams = ClientFilterParams & {
  sla?: string;
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

  const where = buildClientWhere(params, visibleUserIds);

  const include = { assignedTo: true, currentStage: true } as const;
  const orderBy = { createdAt: "desc" as const };

  let pageClients: Prisma.ClientGetPayload<{ include: typeof include }>[];
  let totalCount: number;

  const filtersPromise = Promise.all([
    prisma.stage.findMany({ where: { isActive: true }, orderBy: { sequence: "asc" } }),
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

  const [[stages, users], exceptionsForPage, lastActivities] = await Promise.all([
    filtersPromise,
    prisma.exception.findMany({
      where: { clientId: { in: pageClientIds } },
      select: { clientId: true, stageId: true, reason: true, status: true, createdAt: true, resolvedAt: true },
    }),
    pageClientIds.length
      ? prisma.activity.findMany({
          where: { clientId: { in: pageClientIds } },
          orderBy: [{ clientId: "asc" }, { createdAt: "desc" }],
          distinct: ["clientId"],
        })
      : Promise.resolve([]),
  ]);

  const openExceptionByClient = new Map(
    exceptionsForPage.filter((e) => e.status === "OPEN").map((e) => [e.clientId, e.reason]),
  );
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

  const rmUsers = users.filter((u) => u.role === "RM");
  const exportHref = `/api/clients/export${(() => {
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key !== "page" && value) usp.set(key, value);
    }
    const qs = usp.toString();
    return qs ? `?${qs}` : "";
  })()}`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Clients</CardTitle>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" render={<Link href={exportHref} />}>
            Export CSV
          </Button>
          <BulkImportDialog />
          <NewClientDialog users={users} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ClientFilters stages={stages} users={users} />
        <ClientsBulkSelection rms={rmUsers}>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <ClientSelectAllHeader pageClientIds={pageClientIds} />
                  </TableHead>
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
                  const lastActivity = lastActivityByClient.get(client.id);
                  return (
                    <ClientRow
                      key={client.id}
                      id={client.id}
                      clientCode={client.clientCode}
                      name={client.name}
                      mobile={client.mobile}
                      stageName={client.currentStage.name}
                      ageHours={ageHours}
                      priority={client.priority}
                      nextActionTitle={client.nextActionTitle}
                      nextActionDueAt={client.nextActionDueAt}
                      blockerReason={openExceptionByClient.get(client.id) ?? null}
                      slaStatus={slaStatus}
                      status={client.status}
                      assignedToName={client.assignedTo?.name ?? null}
                      createdAt={client.createdAt}
                      lastActivityAt={lastActivity?.createdAt ?? null}
                    />
                  );
                })}
                {pageClients.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center text-muted-foreground py-8">
                      No clients match these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </ClientsBulkSelection>

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
