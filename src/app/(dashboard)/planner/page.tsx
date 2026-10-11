import Link from "next/link";
import { notFound } from "next/navigation";

import { RailCard, RailFact, StickyRail, WorkspaceHeading, WorkspacePanel, WorkspaceShell, WorkspaceTabs } from "@/components/workspace";
import { can } from "@/lib/access/policy";
import { requireMarketing } from "@/lib/auth/require-role";
import { ensurePlannerDefaults, loadMissing, loadPlanViews } from "@/lib/planner/db";
import { plannerEnabled } from "@/lib/planner/flag";
import { TABS, parseTab, plannerHref } from "@/lib/planner/tabs";

import { BoardTab } from "./board-tab";
import { CalendarTab } from "./calendar-tab";
import { AudiencesTab, PromisesTab } from "./library-tabs";
import { CreatorsTab, DestinationsTab, RoutingTab } from "./registry-tabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaign planner" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** Plan campaigns: a promise shown to an audience on a channel that lands on a destination. Admin and Marketing only. Nothing here publishes, sends or spends. */
export default async function PlannerPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await requireMarketing("marketing-planner");
  if (!plannerEnabled()) notFound();
  const params = await searchParams;
  const tab = parseTab(params.tab);
  const canManage = can(session.user.role, "marketing-planner", "manage");
  const canRegistry = can(session.user.role, "marketing-planner-registry", "manage");
  await ensurePlannerDefaults();
  const [plans, missing] = await Promise.all([loadPlanViews(), loadMissing()]);
  const inReview = plans.filter((p) => p.status === "NEEDS_REVIEW").length;
  const blockers = missing.filter((m) => m.severity === "blocker");
  const tabs = TABS.map((t) => ({ key: t.key, label: t.label, href: plannerHref(t.key) }));

  return (
    <WorkspaceShell
      hasRail
      header={<WorkspaceHeading title="Campaign planner" description="A promise shown to an audience on a channel, landing on a destination. Plan it, check it, then run it in the ad tools yourselves: nothing is published or sent from here." actions={canManage ? <Link href="/planner/new" className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">New plan</Link> : undefined} />}
      tabs={<WorkspaceTabs tabs={tabs} active={tab} idPrefix="plan" label="Planner sections" />}
    >
      <StickyRail
        label="Planner key facts"
        facts={[
          <RailFact key="plans" label="Plans" index={0} hint={`${plans.filter((p) => p.status === "SCHEDULED").length} scheduled`}>{plans.length}</RailFact>,
          <RailFact key="review" label="Waiting for review" index={1} tone={inReview ? "warning" : "default"} hint="Needs a second person">{inReview}</RailFact>,
          <RailFact key="blockers" label="To fix" index={2} tone={blockers.length ? "destructive" : "success"} hint="Blocking approval">{blockers.length}</RailFact>,
        ]}
      >
        <RailCard title="What is missing" labelId="planner-missing">
          {missing.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is missing.</p> : (
            <ul className="grid gap-1.5 text-xs">
              {missing.slice(0, 6).map((m) => <li key={m.id} className="flex gap-1.5"><span className={m.severity === "blocker" ? "font-medium text-destructive" : "text-muted-foreground"}>{m.severity === "blocker" ? "Fix" : "Gap"}</span><span>{m.text}</span></li>)}
              {missing.length > 6 && <li className="text-muted-foreground">and {missing.length - 6} more</li>}
            </ul>
          )}
        </RailCard>
      </StickyRail>
      <WorkspacePanel tab={tab} idPrefix="plan">
        {tab === "board" && <BoardTab />}
        {tab === "calendar" && <CalendarTab month={one(params.month)} />}
        {tab === "promises" && <PromisesTab edit={canManage ? one(params.edit) : undefined} />}
        {tab === "audiences" && <AudiencesTab edit={canManage ? one(params.edit) : undefined} />}
        {tab === "destinations" && <DestinationsTab edit={one(params.edit)} canEdit={canRegistry} />}
        {tab === "creators" && <CreatorsTab edit={one(params.edit)} canEdit={canRegistry} />}
        {tab === "routing" && <RoutingTab edit={one(params.edit)} canEdit={canRegistry} />}
      </WorkspacePanel>
    </WorkspaceShell>
  );
}
