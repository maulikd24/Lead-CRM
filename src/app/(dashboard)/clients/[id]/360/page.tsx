import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { prisma } from "@/lib/db/prisma";
import { requireAccess } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { canOpen360 } from "@/lib/clients/access";
import { customer360Enabled } from "@/lib/c360/flag";
import { attributionEnabled } from "@/lib/attribution/flag";
import { c360Tabs, c360TabHref, parseC360Tab } from "@/lib/c360/tabs";
import { outcomesEnabled } from "@/lib/outcomes/flag";
import { mayEditGoals } from "@/lib/outcomes/goal-input";
import { CopyButton } from "@/components/ui/copy-button";
import { statusLine } from "@/lib/c360/status-line";
import { Button } from "@/components/ui/button";
import { Skeleton, StickyActionBar, StickyRail, WorkspacePanel, WorkspaceShell, WorkspaceTabs } from "@/components/workspace";
import { C360Rail, C360Section, ConsentWarning } from "@/components/c360/rails";
import { RailSkeleton, TimelineSkeleton } from "@/components/c360/rail-views";
import { ServiceChip } from "@/components/c360/service-section";
import { memoryEnabled, serviceStateEnabled } from "@/lib/memory/flag";
import { can } from "@/lib/access/policy";
import { actionLedgerEnabled } from "@/lib/ledger/flag";

import "@/components/c360/c360.css";

export const metadata = { title: "Customer 360" };

const PREFIX = "c360";

export default async function Customer360Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string | string[] }> }) {
  if (!customer360Enabled()) notFound();
  const session = await requireAccess("client-360");
  const [{ id }, { tab: tabParam }] = await Promise.all([params, searchParams]);
  const outcomesOn = outcomesEnabled();
  // Memory and Service tabs: own flag and own registry area (an RM and a manager hold both; MARKETING never reaches this page).
  const memoryOn = memoryEnabled() && can(session.user.role, "customer-memory", "view");
  const serviceOn = serviceStateEnabled() && can(session.user.role, "service-state", "view");
  const attributionOn = attributionEnabled();
  const ledgerOn = actionLedgerEnabled() && can(session.user.role, "action-ledger", "view");
  const tabOptions = { outcomes: outcomesOn, memory: memoryOn, service: serviceOn, attribution: attributionOn, ledger: ledgerOn };
  const tab = parseC360Tab(tabParam, tabOptions);

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

  const line = statusLine({ status: client.status, kycStatus: client.kycRecord?.status ?? null, stage: client.currentStage.name, archived: client.isDeleted }, null);
  const sections = c360Tabs(tabOptions);
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
                  {client.name} <span className="font-mono text-sm font-normal whitespace-nowrap text-muted-foreground">{client.clientCode}</span>
                  <CopyButton value={client.clientCode} label={`client code ${client.clientCode}`} className="-my-2 align-middle" />
                </h1>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground" data-testid="status-line">
                  {line.parts.map((part, i) => (
                    <span key={i} className="inline-flex items-center gap-2">
                      {i > 0 && <span aria-hidden>·</span>}
                      {part}
                    </span>
                  ))}
                  <Suspense fallback={null}>
                    <ConsentWarning clientId={client.id} />
                  </Suspense>
                  {serviceOn && (
                    <Suspense fallback={<Skeleton className="h-5 w-28" />}>
                      <ServiceChip clientId={client.id} />
                    </Suspense>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 max-lg:hidden">
                <Button size="sm" variant="outline" render={<Link href={`/clients/${client.id}`} />}>Client record</Button>
                <Button size="sm" variant="outline" render={<Link href={`/inbox?client=${client.id}`} />}>Open inbox</Button>
              </div>
            </div>
            <StickyActionBar phoneOnly>
              <Button size="lg" variant="outline" render={<Link href={`/clients/${client.id}`} />}>Client record</Button>
              <Button size="lg" variant="outline" render={<Link href={`/inbox?client=${client.id}`} />}>Open inbox</Button>
            </StickyActionBar>
          </>
        }
        tabs={<WorkspaceTabs tabs={tabs} active={tab} idPrefix={PREFIX} label="Customer 360 sections" />}
      >
        <Suspense fallback={<StickyRailFallback />}>
          <C360Rail clientId={client.id} tab={tab} rm={client.assignedTo?.name ?? "Unassigned"} />
        </Suspense>
        <WorkspacePanel tab={tab} idPrefix={PREFIX}>
          <Suspense key={tab} fallback={tab === "timeline" ? <TimelineSkeleton /> : <RailSkeleton label={sections.find((t) => t.key === tab)?.label ?? "section"} rows={6} />}>
            <C360Section clientId={client.id} tab={tab} viewer={{ id: session.user.id, role: session.user.role }} canEditOutcomes={outcomesOn && mayEditGoals(session.user.role, session.user.id, client.assignedToId)} assigneeId={client.assignedToId ?? session.user.id} />
          </Suspense>
        </WorkspacePanel>
      </WorkspaceShell>
    </div>
  );
}

function StickyRailFallback() {
  return (
    <StickyRail label="Key facts">
      <RailSkeleton label="customer summary" rows={7} />
    </StickyRail>
  );
}
