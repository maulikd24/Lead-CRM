import { notFound } from "next/navigation";

import { ShowFirstBlock, WorkspacePanel, WorkspaceShell, WorkspaceTabs, WorkspaceHeading, StickyRail, RailFact } from "@/components/workspace";
import { requireAutopilotViewer } from "@/lib/autopilot/access";
import { auctionInsights } from "@/lib/autopilot/auction";
import { evaluateControls } from "@/lib/autopilot/controls";
import { dataAgeText } from "@/lib/autopilot/derive";
import { autopilotApplyEnabled, autopilotAskEnabled, autopilotPageEnabled } from "@/lib/autopilot/flags";
import { monthlyPacing } from "@/lib/autopilot/pacing";
import { buildRecommendations, tuneFromDenials, withoutSuppressed } from "@/lib/autopilot/recommendations";
import { topRegions } from "@/lib/autopilot/regions";
import { RULE_METRICS, runRules } from "@/lib/autopilot/rules";
import { categoryScorecard, scoreControls } from "@/lib/autopilot/scoring";
import { inr, pct } from "@/lib/autopilot/stats";
import * as store from "@/lib/autopilot/store";
import { TABS, parseTab, tabHrefFor } from "@/lib/autopilot/tabs";
import { timingReport } from "@/lib/autopilot/timing";
import { trackingIntegrity } from "@/lib/autopilot/tracking";
import { wastedSpend } from "@/lib/autopilot/waste";

import { AskBox } from "./ask-box";
import { AuditTab } from "./audit-tab";
import { IssueTable } from "./issue-table";
import { LaunchForm, type SavedDraft } from "./launch-form";
import { PlanInput } from "./plan-input";
import { AuctionTab, PacingTab, RegionsTab, TimingTab, TrackingTab, WasteTab } from "./report-tabs";
import { RulesForm } from "./rules-form";
import { DataAge, Panel } from "./ui";

export const dynamic = "force-dynamic";

export default async function AutopilotPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!autopilotPageEnabled()) notFound();
  const viewer = await requireAutopilotViewer();
  const tab = parseTab((await searchParams).tab);
  const snap = await store.loadSnapshot({ pseudonymous: viewer.pseudonymous });

  const results = evaluateControls(snap);
  const score = scoreControls(results);
  const waste = wastedSpend(snap);
  const [rules, denials] = await Promise.all([store.listRules(), store.recentDenials()]);
  const fresh = [...buildRecommendations(snap, results), ...runRules(snap, rules).proposals];
  const merged = await store.syncRecommendations(fresh);
  const recs = withoutSuppressed(merged, tuneFromDenials(denials));
  const open = recs.filter((r) => r.status === "PENDING");

  const tabs = TABS.map((t) => ({ key: t.key, label: t.label, href: tabHrefFor(t.key), count: t.key === "actions" ? open.length : null }));
  const facts = (
    <>
      <RailFact label="Health score" hint={`Evidence coverage ${pct(score.coverage)}${score.confidence === "normal" ? "" : `, ${score.confidence}`}`} index={0}>{score.score === null ? "n/a" : `${score.score} / 100`}</RailFact>
      <RailFact label="Wasted spend" tone={(waste.wastedShare ?? 0) > 0.15 ? "warning" : "default"} hint={waste.wastedShare === null ? undefined : `${pct(waste.wastedShare, 1)} of ${inr(waste.totalSpend)}`} index={1}>{inr(waste.wasted)}</RailFact>
      <RailFact label="Open issues" index={2}>{String(open.length)}</RailFact>
      <RailFact label="Data" index={3}>{dataAgeText(snap)}</RailFact>
    </>
  );

  let body: React.ReactNode;
  switch (tab) {
    case "audit": body = <><AuditTab cards={categoryScorecard(results)} /><div className="mt-3"><DataAge text={dataAgeText(snap)} /></div></>; break;
    case "actions": body = <Panel title="Issues and actions" description="Each row is a proposal with its evidence. Nothing changes in an ad account until a person approves it and applying is switched on."><ShowFirstBlock name="issues" title="Issues and actions" noun="issues" total={recs.length} limit={3} preview={<IssueTable recs={recs.slice(0, 3)} canApply={autopilotApplyEnabled()} />} full={<IssueTable recs={recs} canApply={autopilotApplyEnabled()} />} /></Panel>; break;
    case "waste": body = <WasteTab waste={waste} />; break;
    case "timing": body = <TimingTab t={timingReport(snap)} />; break;
    case "pacing": body = <PacingTab rows={monthlyPacing(snap, snap.window.until)} planForm={(r) => <PlanInput campaignId={r.campaignId} name={r.campaignName} planned={r.planned} />} />; break;
    case "regions": body = <RegionsTab cities={topRegions(snap, "city")} states={topRegions(snap, "state")} />; break;
    case "auction": body = <AuctionTab a={auctionInsights(snap)} />; break;
    case "tracking": body = <TrackingTab r={trackingIntegrity(snap)} />; break;
    case "launch": {
      const drafts = await store.listDrafts();
      const view: SavedDraft[] = drafts.map((d) => ({ id: d.id, name: d.name, status: d.status, complianceOk: d.complianceOk, annexureApproved: d.annexureApproved, mine: d.createdById === viewer.id, estimates: null }));
      body = <LaunchForm drafts={view} applyOn={autopilotApplyEnabled()} />; break;
    }
    case "rules": body = <RulesForm rules={rules.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled, sentence: `If ${RULE_METRICS[r.metric].label.toLowerCase()} is ${r.op === ">" ? "above" : "below"} ${r.threshold} over ${r.days} days, propose: ${r.action.replace(/_/g, " ")}.` }))} />; break;
    case "ask": body = <AskBox enabled={autopilotAskEnabled()} />; break;
  }

  return (
    <WorkspaceShell
      header={<WorkspaceHeading title="Autopilot" description="A daily audit of your ads, with fixes you approve or deny. It proposes; it never changes an ad account on its own." />}
      tabs={<WorkspaceTabs tabs={tabs} active={tab} idPrefix="ap" label="Autopilot sections" />}
      rail={<StickyRail facts={facts} />}
    >
      <WorkspacePanel tab={tab} idPrefix="ap">{body}</WorkspacePanel>
    </WorkspaceShell>
  );
}
