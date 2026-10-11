import { Suspense } from "react";
import { notFound } from "next/navigation";

import { Skeleton, WorkspaceHeading, WorkspacePanel, WorkspaceShell, WorkspaceTabs } from "@/components/workspace";
import { requireClosedLoopAccess } from "@/lib/closedloop/access";
import { closedLoopEnabled } from "@/lib/closedloop/config";
import { OUTBOX_FILTERS, type OutboxFilter } from "@/lib/closedloop/views-db";
import { parseTab, TABS, tabLink } from "@/lib/closedloop/tabs";

import { CoverageTab } from "./coverage-tab";
import { DestinationsTab } from "./destinations-tab";
import { EventsTab } from "./events-tab";
import { OverviewTab } from "./overview-tab";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

export default async function ClosedLoopPage({ searchParams }: { searchParams: Promise<Params> }) {
  // Access first (Admin or Marketing only), then the flag: a visitor without access learns nothing about the module either way.
  const session = await requireClosedLoopAccess();
  if (!closedLoopEnabled()) notFound();
  const params = await searchParams;
  const tab = parseTab(params.tab);
  const isAdmin = session.user.role === "ADMIN";
  const status = (OUTBOX_FILTERS as readonly string[]).includes(String(params.status)) ? (String(params.status) as OutboxFilter) : "all";
  const tabs = TABS.map((t) => ({ key: t.key, label: t.label, href: tabLink(t.key) }));

  return (
    <WorkspaceShell
      header={<WorkspaceHeading title="Closed loop" description="Tell the ad platforms which customers completed KYC or funded, as coded identifiers only, and only for customers who agreed. Nothing leaves while this is off." />}
      tabs={<WorkspaceTabs tabs={tabs} active={tab} idPrefix="cl" label="Closed loop sections" />}
    >
      <WorkspacePanel tab={tab} idPrefix="cl">
        <Suspense key={`${tab}-${status}`} fallback={<Skeleton className="h-64" />}>
          {tab === "overview" && <OverviewTab isAdmin={isAdmin} />}
          {tab === "events" && <EventsTab status={status} />}
          {tab === "destinations" && <DestinationsTab isAdmin={isAdmin} />}
          {tab === "coverage" && <CoverageTab />}
        </Suspense>
      </WorkspacePanel>
    </WorkspaceShell>
  );
}
