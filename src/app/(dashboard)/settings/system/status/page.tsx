import Link from "next/link";

import { requireRole } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { CUTOVER_CHECKS, cutoverItemId } from "@/lib/system/cutover-checks";
import { collectSystemStatus } from "@/lib/system/status";
import { statusDeps } from "@/lib/system/status-wiring";
import { controlPlaneEnabled } from "@/lib/system/control-plane-flag";
import { formatDateTime } from "@/lib/utils/format";
import { PageHeader } from "@/components/shared/page-header";
import { TabbedWorkspace } from "@/components/workspace";
import { ChecksPanel, JobsPanel, OverviewPanel } from "./status-view";

export const dynamic = "force-dynamic";

export default async function SystemStatusPage() {
  await requireRole(["ADMIN"]);
  const status = await collectSystemStatus(statusDeps, process.env);

  const rows = await prisma.goLiveCheck.findMany({ where: { itemId: { in: CUTOVER_CHECKS.map((c) => cutoverItemId(c.id)) } } }).catch(() => []);
  const people = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.doneById).filter((x): x is string => !!x) } }, select: { id: true, name: true } }).catch(() => []);
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const ticks = Object.fromEntries(rows.map((r) => [r.itemId.replace(/^cutover:/, ""), { done: r.done, note: r.note, byName: r.doneById ? (nameById.get(r.doneById) ?? null) : null, at: r.doneAt ? formatDateTime(r.doneAt) : null }]));
  const openManual = CUTOVER_CHECKS.filter((c) => !c.auto && !ticks[c.id]?.done).length;

  return (
    <TabbedWorkspace
      idPrefix="sysstatus"
      label="System status sections"
      tabs={[
        { key: "overview", label: "Overview", count: status.attention.length || undefined },
        { key: "jobs", label: "Jobs, queues and integrations" },
        { key: "checks", label: "Post-cutover checks", count: openManual || undefined },
      ]}
      panels={{
        overview: <OverviewPanel status={status} />,
        jobs: <JobsPanel status={status} />,
        checks: <ChecksPanel status={status} ticks={ticks} />,
      }}
      header={
        <PageHeader
          title="System status"
          description="Version, database, migrations, flags, scheduler, queues and integrations. Names and counts only: no secret is ever shown."
          actions={
            <span className="flex gap-3">
              {controlPlaneEnabled() && <Link href="/settings/control-plane" className="text-xs font-medium text-muted-foreground underline">Control plane</Link>}
              <Link href="/settings/system" className="text-xs font-medium text-muted-foreground underline">System overview</Link>
            </span>
          }
        />
      }
    />
  );
}
