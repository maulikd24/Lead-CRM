import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { canOpen360 } from "@/lib/clients/access";
import { customer360Enabled } from "@/lib/c360/flag";
import { c360TabHref, C360_TABS, parseC360Tab } from "@/lib/c360/tabs";
import { CLIENT_STATUS_VARIANT } from "@/lib/status-badge-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton, StickyActionBar, StickyRail, WorkspacePanel, WorkspaceShell, WorkspaceTabs } from "@/components/workspace";
import { C360Rail, C360Section, ConsentChip } from "@/components/c360/rails";
import { RailSkeleton, TimelineSkeleton } from "@/components/c360/rail-views";

import "@/components/c360/c360.css";

export const metadata = { title: "Customer 360" };

const PREFIX = "c360";

export default async function Customer360Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string | string[] }> }) {
  if (!customer360Enabled()) notFound();
  const session = await requireUser();
  const [{ id }, { tab: tabParam }] = await Promise.all([params, searchParams]);
  const tab = parseC360Tab(tabParam);

  // Same authorisation as the client detail page (canOpen360 builds on the shared canViewClient rule). Nothing below runs for a
  // client this user may not open, and the rail and sections only ever receive an id that passed this check.
  const [client, visibleUserIds] = await Promise.all([
    prisma.client.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        clientCode: true,
        assignedToId: true,
        isDeleted: true,
        mergedIntoId: true,
        status: true,
        currentStage: { select: { name: true } },
        assignedTo: { select: { name: true } },
        kycRecord: { select: { status: true } },
      },
    }),
    getVisibleUserIds(session.user.id, session.user.role),
  ]);
  if (!client || !canOpen360(session.user.role, visibleUserIds, client)) notFound();

  const sections = C360_TABS;
  const tabs = sections.map((t) => ({ key: t.key, label: t.label, href: c360TabHref(client.id, t.key) }));

  return (
    <div className="c360">
      <WorkspaceShell
        hasRail
        header={
          <>
            <Link href={`/clients/${client.id}`} className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <ArrowLeft className="size-4" /> Back to client
            </Link>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <h1 className="font-heading text-2xl font-semibold tracking-tight">
                  {client.name} <span className="font-mono text-sm font-normal text-muted-foreground">{client.clientCode}</span>
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                  <Badge variant={CLIENT_STATUS_VARIANT[client.status]}>{client.status.replace(/_/g, " ")}</Badge>
                  <Badge variant="outline">{client.currentStage.name}</Badge>
                  <Badge variant={client.kycRecord?.status === "APPROVED" ? "success" : "outline"}>KYC: {client.kycRecord?.status?.replace(/_/g, " ").toLowerCase() ?? "not started"}</Badge>
                  <Suspense fallback={<Skeleton className="h-5 w-28" />}>
                    <ConsentChip clientId={client.id} />
                  </Suspense>
                  {client.isDeleted && <Badge variant="destructive">Archived</Badge>}
                  <span className="ml-1">RM: {client.assignedTo?.name ?? "Unassigned"}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 max-lg:hidden">
                <Button size="sm" render={<Link href={`/clients/${client.id}`} />}>Client record</Button>
                <Button size="sm" variant="outline" render={<Link href={`/inbox?client=${client.id}`} />}>Open inbox</Button>
              </div>
            </div>
            <StickyActionBar phoneOnly>
              <Button size="lg" render={<Link href={`/clients/${client.id}`} />}>Client record</Button>
              <Button size="lg" variant="outline" render={<Link href={`/inbox?client=${client.id}`} />}>Open inbox</Button>
            </StickyActionBar>
          </>
        }
        tabs={<WorkspaceTabs tabs={tabs} active={tab} idPrefix={PREFIX} label="Customer 360 sections" />}
      >
        <Suspense fallback={<StickyRailFallback />}>
          <C360Rail clientId={client.id} tab={tab} />
        </Suspense>
        <WorkspacePanel tab={tab} idPrefix={PREFIX}>
          <Suspense key={tab} fallback={tab === "timeline" ? <TimelineSkeleton /> : <RailSkeleton label={sections.find((t) => t.key === tab)?.label ?? "section"} rows={6} />}>
            <C360Section clientId={client.id} tab={tab} />
          </Suspense>
        </WorkspacePanel>
      </WorkspaceShell>
    </div>
  );
}

function StickyRailFallback() {
  return (
    <StickyRail label="Key facts and next action">
      <RailSkeleton label="customer summary" rows={7} />
    </StickyRail>
  );
}
