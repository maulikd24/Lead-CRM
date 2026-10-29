import { maskMobile } from "@/lib/privacy/contact-mask";
import Link from "next/link";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db/prisma";
import { requireAccess } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { NewClientDialog } from "./new-client-dialog";
import { getAssignmentSettings } from "@/lib/assignment/settings";
import { ClientFilters } from "./client-filters";
import { ClientRow } from "./client-row";
import { ClientSegmentTabs } from "./client-segment-tabs";
import { canViewRevenue, lifetimeRevenueByClient } from "@/lib/clients/lifetime-revenue";
import { ClientQuickViewProvider } from "@/components/clients/client-quick-view";
import { ClientsBulkSelection, ClientSelectAllHeader } from "./clients-bulk-selection";
import { BulkImportDialog } from "./bulk-import-dialog";
import { computeSlaStatus, isReferralLeadSource, stageAgeHours, type SlaStatus } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";
import { buildClientWhere, type ClientFilterParams } from "@/lib/clients/build-client-where";
import { InfoTip } from "@/components/shared/info-tip";
import { DEFINITIONS } from "@/lib/copilot/definitions";
import { nextStepLabelForViewer } from "./next-step-label";
import { can } from "@/lib/access/policy";
import { DENSITY_COOKIE, SAVED_VIEW_SCOPE, parseClientView, parseDensity, withParam } from "@/lib/clients/views";
import { getPipelineBoard, COMPLETED_WINDOW_DAYS } from "@/lib/pipeline/board";
import { BOARD_FILTERS, parseBoardFilter } from "@/lib/pipeline/board-logic";
import { formatInrCompact } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { PipelineBoard } from "../pipeline/pipeline-board";
import { ViewsToolbar } from "./views-toolbar";
import type { OwnerOption } from "./inline-cells";

export const metadata = { title: "Clients" };

const PAGE_SIZE = 25;

type SearchParams = ClientFilterParams & {
  sla?: string;
  page?: string;
  /** "board" shows the same filters as the stage board; anything else is the list. */
  view?: string;
  /** The board's quick filter (mine, hot, at risk). */
  filter?: string;
};

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireAccess("clients");
  const params = await searchParams;
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const view = parseClientView(params.view);
  const density = parseDensity((await cookies()).get(DENSITY_COOKIE)?.value);
  const savedViews = await prisma.savedView.findMany({ where: { userId: session.user.id, scope: SAVED_VIEW_SCOPE }, orderBy: { name: "asc" }, select: { id: true, name: true, query: true } });

  if (view === "board") return <BoardView params={params} session={session} visibleUserIds={visibleUserIds} savedViews={savedViews} />;

  const currentPage = Math.max(1, Number(params.page) || 1);

  const assignmentSettings = await getAssignmentSettings();
  const where = buildClientWhere(params, visibleUserIds, { includeUnassigned: session.user.role === "MANAGER" });

  // The same records the client detail page loads, so the next-step label is computed from the same data.
  const include = {
    assignedTo: true,
    currentStage: true,
    documents: { select: { documentType: true, mandatory: true, status: true }, orderBy: { createdAt: "asc" }, take: 50 },
    kycRecord: true,
    fundingRecord: true,
    dealerIntroduction: true,
    activities: { select: { type: true, payload: true }, orderBy: { createdAt: "desc" }, take: 50 },
  } as const;
  const orderBy = { createdAt: "desc" as const };

  // Inferred from the client (not Prisma.ClientGetPayload) so the global passwordHash omit is reflected.
  let pageClients: Awaited<ReturnType<typeof prisma.client.findMany<{ include: typeof include }>>>;
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
      const status = isReferralLeadSource(client.leadSource)
        ? "NOT_APPLICABLE"
        : computeSlaStatus(effectiveStageEnteredAt(client.stageEnteredAt, heldMs), client.currentStage.slaHours, now);
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

  const showRevenue = canViewRevenue(session.user.role);
  const [[stages, users], exceptionsForPage, lastActivities, revenueByClient] = await Promise.all([
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
    showRevenue ? lifetimeRevenueByClient(pageClientIds) : Promise.resolve(new Map<string, number>()),
  ]);

  const openExceptionByClient = new Map(
    exceptionsForPage.filter((e) => e.status === "OPEN").map((e) => [e.clientId, e.reason]),
  );
  const lastActivityByClient = new Map(lastActivities.map((a) => [a.clientId, a]));
  const now = new Date();

  function slaStatusFor(client: (typeof pageClients)[number]): SlaStatus {
    if (isReferralLeadSource(client.leadSource)) return "NOT_APPLICABLE";
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
  // Inline edits: anyone who manages clients edits priority and follow-ups on rows they can see. Reassigning follows
  // reassignClientAction's own rule (an Admin any client, a Manager their team's or unassigned, an RM only their own).
  const canEdit = can(session.user.role, "clients", "manage");
  const owners: OwnerOption[] = users.filter((u) => u.role === "RM" || u.role === "MANAGER").map((u) => ({ id: u.id, name: u.name }));
  const mayReassign = (assignedToId: string | null) =>
    session.user.role === "ADMIN" ||
    (session.user.role === "MANAGER" && (!assignedToId || !visibleUserIds || visibleUserIds.includes(assignedToId))) ||
    (session.user.role === "RM" && assignedToId === session.user.id);
  const exportHref = `/api/clients/export${(() => {
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key !== "page" && value) usp.set(key, value);
    }
    const qs = usp.toString();
    return qs ? `?${qs}` : "";
  })()}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Clients"
        description={`${totalCount} client${totalCount === 1 ? "" : "s"} in the pipeline.`}
        actions={
          <>
            <Button size="sm" variant="outline" render={<Link href={exportHref} />}>
              Export CSV
            </Button>
            <BulkImportDialog />
            <NewClientDialog users={users} assignmentMode={assignmentSettings.mode} />
          </>
        }
      />
      <Card>
        <CardContent className="flex flex-col gap-4">
        <ViewsToolbar view="list" density={density} views={savedViews} />
        <ClientSegmentTabs params={params} />
        <ClientFilters stages={stages} users={users} canFilterUnassigned={session.user.role === "ADMIN" || session.user.role === "MANAGER"} />
        <ClientQuickViewProvider>
        <ClientsBulkSelection rms={rmUsers} currentUserRole={session.user.role}>
            <Table>
              <TableHeader sticky>
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
                  <TableHead>SLA Status<InfoTip label="SLA">{DEFINITIONS.sla}</InfoTip></TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned RM</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Activity</TableHead>
                  {showRevenue && <TableHead className="text-right">Lifetime Revenue</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody striped>
                {pageClients.map((client, index) => {
                  const ageHours = stageAgeHours(client.stageEnteredAt);
                  const slaStatus = slaStatusFor(client);
                  const lastActivity = lastActivityByClient.get(client.id);
                  return (
                    <ClientRow
                      key={client.id}
                      index={index}
                      id={client.id}
                      clientCode={client.clientCode}
                      name={client.name}
                      mobile={maskMobile(client.mobile)}
                      stageName={client.currentStage.name}
                      ageHours={ageHours}
                      priority={client.priority}
                      nextStepLabel={nextStepLabelForViewer(client, session.user.role, visibleUserIds)}
                      nextActionTitle={client.nextActionTitle}
                      nextActionDueAt={client.nextActionDueAt}
                      blockerReason={openExceptionByClient.get(client.id) ?? null}
                      slaStatus={slaStatus}
                      status={client.status}
                      assignedToId={client.assignedToId}
                      assignedToName={client.assignedTo?.name ?? null}
                      owners={canEdit && mayReassign(client.assignedToId) ? owners : []}
                      canEdit={canEdit}
                      density={density}
                      createdAt={client.createdAt}
                      lastActivityAt={lastActivity?.createdAt ?? null}
                      lifetimeRevenue={showRevenue ? (revenueByClient.get(client.id) ?? 0) : undefined}
                    />
                  );
                })}
                {pageClients.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={showRevenue ? 14 : 13} className="text-center text-muted-foreground py-8">
                      No clients match these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
        </ClientsBulkSelection>
        </ClientQuickViewProvider>

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
    </div>
  );
}

/** The same /clients filters as the stage board: drag a card through the stage's own forms (KYC, funding...), as /pipeline did. */
async function BoardView({
  params,
  session,
  visibleUserIds,
  savedViews,
}: {
  params: SearchParams;
  session: Awaited<ReturnType<typeof requireAccess>>;
  visibleUserIds: string[] | null;
  savedViews: { id: string; name: string; query: string }[];
}) {
  const filter = parseBoardFilter(params.filter);
  const canPickRm = session.user.role !== "RM";
  const [columns, stages, users] = await Promise.all([
    getPipelineBoard({ userId: session.user.id, role: session.user.role, visibleUserIds, filter, rm: canPickRm ? params.rm : undefined, params }),
    prisma.stage.findMany({ where: { isActive: true }, orderBy: { sequence: "asc" } }),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  const open = columns.slice(0, -1);
  const openCount = open.reduce((sum, c) => sum + c.count, 0);
  const openValue = open.reduce((sum, c) => sum + c.totalExpected, 0);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Clients"
        description={`${openCount} client${openCount === 1 ? "" : "s"} onboarding · ${formatInrCompact(openValue)} expected. Drag a card to the next stage, or use its Next stage button.`}
        actions={<NewClientDialog users={users} assignmentMode={(await getAssignmentSettings()).mode} />}
      />
      <Card className="min-w-0">
        <CardContent className="flex min-w-0 flex-col gap-4">
          <ViewsToolbar view="board" density="comfortable" views={savedViews} />
          <ClientFilters stages={stages} users={users} canFilterUnassigned={session.user.role === "ADMIN" || session.user.role === "MANAGER"} forBoard />
          <nav aria-label="Board filter" className="flex w-fit items-center gap-1 rounded-md border border-border p-0.5">
            {BOARD_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={withParam(params, "filter", f.key === "all" ? null : f.key)}
                aria-current={filter === f.key ? "page" : undefined}
                className={cn("rounded px-3 py-1.5 text-xs font-semibold transition-colors", filter === f.key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
              >
                {f.label}
              </Link>
            ))}
          </nav>
          <PipelineBoard columns={columns} role={session.user.role} completedWindowDays={COMPLETED_WINDOW_DAYS} />
        </CardContent>
      </Card>
    </div>
  );
}
