import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/shared/page-header";
import { CountUp, KpiStrip, KpiTile, Skeleton, TabbedWorkspace, lazyPanels } from "@/components/workspace";
import { requireAccess } from "@/lib/auth/require-role";
import { drawerFlagOn, engineFlagOn } from "@/lib/intelligence/decision/enabled";
import { disagreementSummary } from "@/lib/intelligence/decision/review-db";
import { latestReplayRun } from "@/lib/intelligence/decision/replay-db";
import { computeShadowReport } from "@/lib/intelligence/decision/shadow-stats-db";
import { CriteriaView, DifferencesView, FeedbackView, ReplayView } from "./report-view";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "criteria", label: "Exit criteria" },
  { key: "replay", label: "Replay" },
  { key: "differences", label: "Differences" },
  { key: "feedback", label: "Feedback and outcomes" },
] as const;
const KEYS = TABS.map((t) => t.key);

export default async function DecisionShadowReportPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  await requireAccess("decision-report");
  if (!drawerFlagOn()) notFound();
  const sp = await searchParams;
  const now = new Date();
  const report = await computeShadowReport(now);
  const passing = report.exit.criteria.filter((c) => c.status === "pass").length;

  const panels = lazyPanels(KEYS, sp.tab, "criteria", {
    criteria: () => <CriteriaView report={report} />,
    replay: () => <ReplayPanel />,
    differences: () => <DifferencesPanel report={report} since={new Date(report.since)} />,
    feedback: () => <FeedbackView report={report} />,
  });

  const rate = report.stats.daily.length ? report.stats.daily[report.stats.daily.length - 1] : null;
  return (
    <TabbedWorkspace
      lazy
      idPrefix="decshadow"
      label="Decision shadow report sections"
      tabs={TABS.map((t) => ({ ...t }))}
      panels={panels}
      header={
        <div className="flex flex-col gap-2">
          <PageHeader title="Decision Engine shadow report" description={`${engineFlagOn() ? "The engine is computing decisions in shadow." : "The engine flag (NBA_ENGINE_V2) is off in this process: nothing new is being stored."} Nothing here reaches an RM.`} />
          <KpiStrip label="Shadow report key figures">
            <KpiTile label="Exit criteria passing" index={0} tone={passing === report.exit.criteria.length ? "success" : "default"} hint="a person decides">
              <CountUp value={passing} label="criteria passing" suffix={` of ${report.exit.criteria.length}`} />
            </KpiTile>
            <KpiTile label={`Decisions, last ${report.windowDays} days`} index={1}>
              <CountUp value={report.stats.decisions} label="decisions" />
            </KpiTile>
            <KpiTile label="Material regressions" index={2} tone={report.stats.materialRegressions > 0 ? "destructive" : "success"} hint="must stay at zero">
              <CountUp value={report.stats.materialRegressions} label="material regressions" />
            </KpiTile>
            <KpiTile label="Consent agreement" index={3} tone={report.stats.consent.mismatches > 0 ? "destructive" : "default"} hint={`${report.stats.consent.checked} contact decisions checked`}>
              {report.stats.consent.checked === 0 ? "n/a" : `${(100 - (100 * report.stats.consent.mismatches) / report.stats.consent.checked).toFixed(1)}%`}
            </KpiTile>
            <KpiTile label="Disagreement, latest day" index={4} hint="differs from the current engine">
              {rate ? `${Math.round((1000 * rate.disagreements) / Math.max(1, rate.decisions)) / 10}%` : "n/a"}
            </KpiTile>
          </KpiStrip>
        </div>
      }
    />
  );
}

async function ReplayPanel() {
  const run = await latestReplayRun();
  return <ReplayView run={run} />;
}

async function DifferencesPanel({ report, since }: { report: Awaited<ReturnType<typeof computeShadowReport>>; since: Date }) {
  const summary = await disagreementSummary(since);
  return (
    <Suspense fallback={<Skeleton className="h-40" />}>
      <DifferencesView summary={summary} report={report} />
    </Suspense>
  );
}
