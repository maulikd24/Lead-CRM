import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { requireAccess } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton, TabbedWorkspace, lazyPanels } from "@/components/workspace";
import { runAlertEvaluation } from "@/lib/system/alerts-db";
import { controlPlaneEnabled } from "@/lib/system/control-plane-flag";
import { panel, readFailures, readHealth, readIntegrations, readJobs, readStrip } from "@/lib/system/control-plane-read";
import { FailuresView, HealthView, IntegrationsView, JobsView, PanelError, StripView } from "./control-plane-view";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "health", label: "Health" },
  { key: "jobs", label: "Jobs" },
  { key: "failures", label: "Failures" },
  { key: "integrations", label: "Integrations" },
] as const;
const KEYS = TABS.map((t) => t.key);

// The alert rules also run on every page load, idempotently, but at most once a minute per server instance.
let lastEvaluation = 0;
async function evaluateAlertsSometimes(now: number) {
  if (now - lastEvaluation < 60_000) return;
  lastEvaluation = now;
  await panel(() => runAlertEvaluation(new Date(now)), 4000);
}

async function HealthPanel() {
  const now = new Date();
  return <HealthView health={await readHealth(now)} now={now} />;
}
async function JobsPanel() {
  const now = new Date();
  const r = await panel(() => readJobs(now));
  return r.ok ? <JobsView jobs={r.data} now={now} /> : <PanelError name="Jobs" error={r} />;
}
async function FailuresPanel() {
  const now = new Date();
  const r = await panel(() => readFailures(now));
  return r.ok ? <FailuresView groups={r.data} now={now} /> : <PanelError name="Failures" error={r} />;
}
async function IntegrationsPanel() {
  const now = new Date();
  const r = await panel(() => readIntegrations(now));
  return r.ok ? <IntegrationsView rows={r.data} now={now} /> : <PanelError name="Integrations" error={r} />;
}
const wrap = (node: React.ReactNode) => <Suspense fallback={<Skeleton className="h-64" />}>{node}</Suspense>;

export default async function ControlPlanePage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  await requireAccess("control-plane");
  if (!controlPlaneEnabled()) notFound();

  const sp = await searchParams;
  const now = new Date();
  await evaluateAlertsSometimes(now.getTime());
  const strip = await readStrip(now);

  const panels = lazyPanels(KEYS, sp.tab, "health", {
    health: () => wrap(<HealthPanel />),
    jobs: () => wrap(<JobsPanel />),
    failures: () => wrap(<FailuresPanel />),
    integrations: () => wrap(<IntegrationsPanel />),
  });

  return (
    <TabbedWorkspace
      lazy
      idPrefix="ctrlplane"
      label="Control plane sections"
      tabs={TABS.map((t) => ({ ...t }))}
      panels={panels}
      header={
        <div className="flex flex-col gap-2">
          <PageHeader
            title="Control plane"
            description="Health, jobs, failures and integrations. Counts, classes and times only: no secret, no customer detail."
            actions={<Link href="/settings/system/status" className="text-xs font-medium text-muted-foreground underline">System status</Link>}
          />
          <StripView data={strip} now={now} />
        </div>
      }
    />
  );
}
