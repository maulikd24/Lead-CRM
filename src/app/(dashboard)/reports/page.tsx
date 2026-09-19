import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import Link from "next/link";

import { StageFunnelChartLoader } from "./stage-funnel-chart-loader";
import { StageAgingHeatmap } from "./stage-aging-heatmap";
import { LeadsActivitySection } from "./leads-activity-section";
import { RmPerformanceTable } from "./rm-performance-table";
import { getReportsPageData } from "@/lib/reports/get-reports-page-data";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { RankedBarList } from "@/components/shared/ranked-bar-list";
import { EmptyState } from "@/components/shared/empty-state";
import { Workflow } from "lucide-react";
import { thresholdTone } from "@/lib/report-tone";
import type { Prisma } from "@/generated/prisma/client";

type ReportsSearchParams = { laGranularity?: string; laFrom?: string; laTo?: string };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<ReportsSearchParams>;
}) {
  const params = await searchParams;
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const clientFilter: Prisma.ClientWhereInput = visibleUserIds
    ? { assignedToId: { in: visibleUserIds }, isDeleted: false }
    : { isDeleted: false };
  const now = new Date();

  const {
    totalLeads,
    activeClients,
    completedClients,
    notProceedingClients,
    onHoldClients,
    overdueCount,
    slaCompliance,
    avgOnboardingDays,
    funnelData,
    conversionData,
    stageDurations,
    lostReasonGroups,
    sourcePerformance,
    rmPerformance,
    aging,
    slaByStage,
    slaByRm,
  } = await getReportsPageData(clientFilter, visibleUserIds, now);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description="Pipeline health, conversion, and team performance."
        actions={
          <Button variant="outline" size="sm" render={<Link href="/api/reports/summary-pdf" />}>
            Download PDF
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Leads" value={totalLeads} />
        <StatCard label="Active Onboarding" value={activeClients} />
        <StatCard label="Completed" value={completedClients} tone="success" />
        <StatCard label="Not Proceeding" value={notProceedingClients} />
        <StatCard label="On Hold" value={onHoldClients} tone="warning" />
        <StatCard label="Overdue" value={overdueCount} tone={overdueCount > 0 ? "destructive" : "default"} />
        <StatCard label="SLA Compliance" value={`${slaCompliance}%`} tone={slaCompliance < 80 ? "warning" : "success"} />
        <StatCard label="Avg Onboarding Time" value={avgOnboardingDays > 0 ? `${avgOnboardingDays}d` : "—"} />
      </div>

      <LeadsActivitySection searchParams={params} clientWhere={clientFilter} />

      <Card>
        <CardHeader>
          <CardTitle>Stage Funnel</CardTitle>
        </CardHeader>
        <CardContent>
          {funnelData.length === 0 ? (
            <EmptyState
              icon={Workflow}
              title="No pipeline stages configured"
              description="Add your onboarding stages in Settings → Stages to see the funnel."
              action={session.user.role === "ADMIN" ? { label: "Go to Stages", href: "/settings/stages" } : undefined}
            />
          ) : (
            <StageFunnelChartLoader data={funnelData} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stage Aging</CardTitle>
          <p className="text-sm text-muted-foreground">
            Where currently-active clients are piling up right now, by how long they've been in each stage.
          </p>
        </CardHeader>
        <CardContent>
          <StageAgingHeatmap rows={aging} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>SLA Breach &amp; Overdue Summary</CardTitle>
          <Link href="/exceptions" className="text-sm text-primary underline">
            Open Exceptions queue
          </Link>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">By Stage</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stage</TableHead>
                    <TableHead>Overdue</TableHead>
                    <TableHead>Due Soon</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slaByStage.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="text-sm">{row.label}</TableCell>
                      <TableCell className={thresholdTone(row.overdue, 1)}>{row.overdue}</TableCell>
                      <TableCell className="text-muted-foreground">{row.dueSoon}</TableCell>
                    </TableRow>
                  ))}
                  {slaByStage.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                        No pipeline stages configured yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">By RM</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>RM</TableHead>
                    <TableHead>Overdue</TableHead>
                    <TableHead>Due Soon</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slaByRm.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="text-sm">{row.label}</TableCell>
                      <TableCell className={thresholdTone(row.overdue, 1)}>{row.overdue}</TableCell>
                      <TableCell className="text-muted-foreground">{row.dueSoon}</TableCell>
                    </TableRow>
                  ))}
                  {slaByRm.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                        No RMs to report on yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stage Conversion</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead>Reached</TableHead>
                  <TableHead>% of Stage 1</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conversionData.map((row) => (
                  <TableRow key={row.stage}>
                    <TableCell className="text-sm">{row.stage}</TableCell>
                    <TableCell>{row.reached}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.pct}%</TableCell>
                  </TableRow>
                ))}
                {conversionData.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                      No pipeline stages configured yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bottleneck Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead>Avg Time in Stage</TableHead>
                  <TableHead>Sample</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stageDurations.map((row) => (
                  <TableRow key={row.stageId}>
                    <TableCell className="text-sm">{row.stageName}</TableCell>
                    <TableCell className={thresholdTone(row.avgHours, 72)}>
                      {row.avgHours < 24 ? `${Math.round(row.avgHours)}h` : `${Math.round((row.avgHours / 24) * 10) / 10}d`}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.sampleSize}</TableCell>
                  </TableRow>
                ))}
                {stageDurations.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                      No pipeline stages configured yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lost Reasons</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reason</TableHead>
                  <TableHead>Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lostReasonGroups.map((row) => (
                  <TableRow key={row.reason ?? "unspecified"}>
                    <TableCell className="text-sm">{row.reason ?? "Unspecified"}</TableCell>
                    <TableCell>{row.count}</TableCell>
                  </TableRow>
                ))}
                {lostReasonGroups.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground py-6">
                      No clients marked not proceeding yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Source Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={sourcePerformance.map((row) => ({
                label: row.source,
                value: row.total,
                displayValue: `${row.completed}/${row.total} · ${row.total > 0 ? Math.round((row.completed / row.total) * 100) : 0}%`,
              }))}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>RM Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <RmPerformanceTable rows={rmPerformance} />
        </CardContent>
      </Card>
    </div>
  );
}
