import Link from "next/link";

import { can } from "@/lib/access/policy";
import { buildFlagsPanel } from "@/lib/flags/panel";
import { requireRole } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { CUTOVER_CHECKS, cutoverItemId } from "@/lib/system/cutover-checks";
import { collectSystemStatus } from "@/lib/system/status";
import { statusDeps } from "@/lib/system/status-wiring";
import { formatDateTime } from "@/lib/utils/format";
import { PageHeader } from "@/components/shared/page-header";
import { TabbedWorkspace, lazyPanels } from "@/components/workspace";
import { FlagsPanel } from "./flags-view";
import { ChecksPanel, JobsPanel, OverviewPanel } from "./status-view";

export const dynamic = "force-dynamic";

export default async function SystemStatusPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const session = await requireRole(["ADMIN"]);
  const { tab } = await searchParams;
  // The Flags tab is its own area in the access registry (ADMIN only, read only): the tab and its data exist only when the registry allows it.
  const flags = can(session.user.role, "settings-flags") ? buildFlagsPanel(process.env) : null;
  const status = await collectSystemStatus(statusDeps, process.env);

  const rows = await prisma.goLiveCheck.findMany({ where: { itemId: { in: CUTOVER_CHECKS.map((c) => cutoverItemId(c.id)) } } }).catch(() => []);
  const people = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.doneById).filter((x): x is string => !!x) } }, select: { id: true, name: true } }).catch(() => []);
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const ticks = Object.fromEntries(rows.map((r) => [r.itemId.replace(/^cutover:/, ""), { done: r.done, note: r.note, byName: r.doneById ? (nameById.get(r.doneById) ?? null) : null, at: r.doneAt ? formatDateTime(r.doneAt) : null }]));
  const openManual = CUTOVER_CHECKS.filter((c) => !c.auto && !ticks[c.id]?.done).length;

  const tabs = [
    { key: "overview", label: "Overview", count: status.attention.length || undefined },
    { key: "jobs", label: "Jobs, queues and integrations" },
    { key: "checks", label: "Post-cutover checks", count: openManual || undefined },
    ...(flags ? [{ key: "flags", label: "Flags", count: flags.summary.errors || undefined }] : []),
  ];
  const panels = lazyPanels(
    tabs.map((t) => t.key),
    tab,
    "overview",
    {
      overview: () => <OverviewPanel status={status} />,
      jobs: () => <JobsPanel status={status} />,
      checks: () => <ChecksPanel status={status} ticks={ticks} />,
      ...(flags ? { flags: () => <FlagsPanel data={flags} /> } : {}),
    },
  );

  return (
    <TabbedWorkspace
      idPrefix="sysstatus"
      label="System status sections"
      lazy
      tabs={tabs}
      panels={panels}
      header={
        <PageHeader
          title="System status"
          description="Version, database, migrations, flags, scheduler, queues and integrations. Names and counts only: no secret is ever shown."
          actions={<Link href="/settings/system" className="text-xs font-medium text-muted-foreground underline">System overview</Link>}
        />
      }
    />
  );
}
