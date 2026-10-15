import Link from "next/link";
import { notFound } from "next/navigation";

import { EditSheet } from "@/components/planner/edit-sheet";
import { RailFact, StickyRail, WorkspaceHeading, WorkspacePanel, WorkspaceShell, WorkspaceTabs } from "@/components/workspace";
import { requireMarketing } from "@/lib/auth/require-role";
import { isAgentEnabled } from "@/lib/agents/wiring";
import { loadPlanDetail } from "@/lib/planner/db";
import { PLANNER_COPY_AGENT_KEY } from "@/lib/planner/copy";
import { plannerEnabled } from "@/lib/planner/flag";
import { PLAN_TABS, parsePlanTab } from "@/lib/planner/tabs";
import { STATUS_LABELS, type PlanStatus } from "@/lib/planner/workflow";

import { StatusBadge, NotLiveBadge, channelLabel } from "../ui";
import { CopySection, EditSection, FunnelSection, HistorySection, LinksSection, OverviewSection } from "./sections";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaign plan" };

/** One plan: overview and checklist, tracked links with QR codes, copy drafts, the funnel estimate, the edit form and the audit trail. */
export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireMarketing("marketing-planner");
  if (!plannerEnabled()) notFound();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const tab = parsePlanTab(sp.tab);
  const d = await loadPlanDetail(id);
  if (!d) notFound();
  const { row } = d;
  const status = row.status as PlanStatus;
  const failing = d.checklist.filter((i) => i.status === "fail").length;
  const tabs = PLAN_TABS.map((t) => ({ key: t.key, label: t.label, href: t.key === "overview" ? `/planner/${id}` : `/planner/${id}?tab=${t.key}` }));
  const aiOn = tab === "copy" ? await isAgentEnabled(PLANNER_COPY_AGENT_KEY) : false;

  return (
    <WorkspaceShell
      hasRail
      header={
        <>
          <Link href="/planner" className="text-xs text-primary underline-offset-4 hover:underline">All plans</Link>
          <WorkspaceHeading title={row.title} description={`${row.audience.name} on ${channelLabel(row.channel)}. Campaign code ${row.code}.`} actions={<><StatusBadge status={status} /><Link href={`/planner/${id}?edit=1`} className="inline-flex h-8 items-center rounded-lg border px-3 text-sm font-medium hover:bg-muted">Edit plan</Link></>} />
        </>
      }
      tabs={<WorkspaceTabs tabs={tabs} active={tab} idPrefix="planx" label="Plan sections" />}
    >
      <StickyRail
        label="Plan key facts"
        facts={[
          <RailFact key="status" label="Status" index={0}>{STATUS_LABELS[status]}</RailFact>,
          <RailFact key="check" label="Checklist" index={1} tone={failing ? "destructive" : "success"} hint={failing ? "Items to fix" : "All pass"}>{d.checklist.length - failing} of {d.checklist.length}</RailFact>,
          <RailFact key="dest" label="Destination" index={2} hint={<NotLiveBadge status={row.destination.status} />}>{row.destination.name}</RailFact>,
        ]}
      />
      {sp.edit === "1" && (
        <EditSheet name="edit-plan" title="Edit plan" description={status === "DRAFT" ? undefined : "Saving sends the plan back to draft and withdraws any approval."} closeHref={`/planner/${id}`}>
          <EditSection d={d} />
        </EditSheet>
      )}
      <WorkspacePanel tab={tab} idPrefix="planx">
        {tab === "overview" && <OverviewSection d={d} viewer={{ id: session.user.id }} />}
        {tab === "links" && <LinksSection d={d} />}
        {tab === "copy" && <CopySection d={d} viewer={{ id: session.user.id }} aiOn={aiOn} />}
        {tab === "funnel" && <FunnelSection d={d} />}
        {tab === "history" && <HistorySection d={d} />}
      </WorkspacePanel>
    </WorkspaceShell>
  );
}
