import { notFound } from "next/navigation";

import { ShowFirstBlock, WorkspacePanel, WorkspaceShell, WorkspaceTabs, WorkspaceHeading, StickyRail, RailFact } from "@/components/workspace";
import { requireMarketing } from "@/lib/auth/require-role";
import { auctionInsights } from "@/lib/autopilot/auction";
import { ensureFreshAudit, latestAuditRun } from "@/lib/autopilot/audit-db";
import { latestDigest } from "@/lib/autopilot/digest-db";
import { evaluateControls } from "@/lib/autopilot/controls";
import { dataAgeText } from "@/lib/autopilot/derive";
import { autopilotApplyEnabled, autopilotAskEnabled, autopilotPageEnabled } from "@/lib/autopilot/flags";
import { monthlyPacing } from "@/lib/autopilot/pacing";
import { tuneFromDenials, withoutSuppressed } from "@/lib/autopilot/recommendations";
import { topRegions } from "@/lib/autopilot/regions";
import { RULE_METRICS } from "@/lib/autopilot/rules";
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
import { DigestPanel } from "./digest-panel";
import { RulesForm } from "./rules-form";
import { DataAge, Panel } from "./ui";

export const dynamic = "force-dynamic";

export default async function AutopilotPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!autopilotPageEnabled()) notFound();
  const session = await requireMarketing("marketing-autopilot", "view");
  const viewer = { id: session.user.id, role: session.user.role };
  const tab = parseTab((await searchParams).tab);
  const rules = await store.listRules();
  const caller = { kind: "user" as const, id: viewer.id, role: viewer.role };
  // The newest audit is at most six hours old: the daily job normally keeps it so; a person opening the page after a quiet spell triggers one.
  await ensureFreshAudit({ startedById: null }).catch(() => undefined);
  const snap = await store.loadSnapshot({ caller, ruleWindows: rules.filter((r) => r.enabled).map((r) => r.days) });

  const results = evaluateControls(snap);
  const score = scoreControls(results);
  const waste = wastedSpend(snap);
  const [stored, denials, lastRun] = await Promise.all([store.listRecommendations(), store.recentDenials(), latestAuditRun()]);
  const recs = withoutSuppressed(stored, tuneFromDenials(denials));
  const open = recs.filter((r) => r.status === "PENDING");

  const tabs = TABS.map((t) => ({ key: t.key, label: t.label, href: tabHrefFor(t.key), count: t.key === "actions" ? open.length : null }));
  const facts = (
    <>
      <RailFact label="Health score" hint={`Evidence coverage ${pct(score.coverage)}${score.confidence === "normal" ? "" : `, ${score.confidence}`}`} index={0}>{score.score === null ? "n/a" : `${score.score} / 100`}</RailFact>
      <RailFact label="Wasted spend" tone={(waste.wastedShare ?? 0) > 0.15 ? "warning" : "default"} hint={waste.wastedShare === null ? undefined : `${pct(waste.wastedShare, 1)} of ${inr(waste.totalSpend)}`} index={1}>{inr(waste.wasted)}</RailFact>
      <RailFact label="Open issues" index={2}>{String(open.length)}</RailFact>
      <RailFact label="Data" hint={lastRun ? `Last audit ${lastRun.startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : "No audit yet"} index={3}>{dataAgeText(snap)}</RailFact>
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
    case "rules": body = <RulesForm rules={rules.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled, sentence: `If ${RULE_METRICS[r.metric].label.toLowerCase()} is ${r.op === ">" ? "above" : "below"} ${r.threshold} over ${r.days} days${r.accountIds ? ` in ${r.accountIds.length} account${r.accountIds.length === 1 ? "" : "s"}` : ""}${r.campaignIds ? ` for ${r.campaignIds.length} campaign${r.campaignIds.length === 1 ? "" : "s"}` : ""}, propose: ${r.action.replace(/_/g, " ")}.` }))} campaigns={snap.campaigns.map((c) => ({ id: c.id, name: c.name, accountId: c.accountId ?? null }))} aiEnabled={autopilotAskEnabled()} secondApprover={await store.requireSecondApprover()} />; break;
    case "digest": { const d = await latestDigest(); body = <DigestPanel digest={d ? { id: d.id, weekStart: d.weekStart, subject: d.subject, body: d.body, status: d.status } : null} lastAudit={lastRun ? lastRun.startedAt.toISOString().slice(0, 16).replace("T", " ") + " UTC" : null} />; break; }
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
