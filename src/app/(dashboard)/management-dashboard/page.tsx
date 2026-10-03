import Link from "next/link";
import { AiSummaryCard } from "@/components/ai-summary-card";
import { Workflow } from "lucide-react";
import { format } from "date-fns";

import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { getReportsPageData } from "@/lib/reports/get-reports-page-data";
import { getTeamActivityRows } from "@/lib/reports/team-performance";
import { parseManagementPeriodParams, granularityForPeriod, formatPeriodLabel } from "@/lib/reports/period-range";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { LeadsActivitySection } from "../reports/leads-activity-section";
import { PeriodPicker } from "./period-picker";
import { thresholdTone } from "@/lib/report-tone";
import type { Prisma } from "@/generated/prisma/client";

type ManagementDashboardSearchParams = {
  period?: string;
  anchor?: string;
  from?: string;
  to?: string;
};

function formatInr(amount: number) {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

const LOST_STAGE_ID = "__LOST__";

export default async function ManagementDashboardPage({
  searchParams,
}: {
  searchParams: Promise<ManagementDashboardSearchParams>;
}) {
  const params = await searchParams;
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const clientFilter: Prisma.ClientWhereInput = visibleUserIds
    ? { assignedToId: { in: visibleUserIds }, isDeleted: false }
    : { isDeleted: false };
  const now = new Date();

  const { granularity, anchor, from, to, isCustom } = parseManagementPeriodParams(params, now);

  const {
    totalLeads,
    activeClients,
    completedClients,
    onHoldClients,
    slaCompliance,
    avgOnboardingDays,
    funnelData,
    conversionData,
    stageDurations,
    rmPerformance,
  } = await getReportsPageData(clientFilter, visibleUserIds, now, { from, to });
  const activityByRm = await getTeamActivityRows(
    rmPerformance.map((row) => row.rm.id),
    { from, to },
  );
  const conversionByStageId = new Map(conversionData.map((c) => [c.stageId, c]));
  const stageDurationByStageId = new Map(stageDurations.map((d) => [d.stageId, d]));

  // format(), not toISOString().slice(0,10) — the latter converts to UTC first, which silently
  // drops a calendar day whenever local midnight has a positive UTC offset (e.g. IST).
  const anchorValue = format(anchor, "yyyy-MM-dd");
  const fromValue = format(from, "yyyy-MM-dd");
  const toValue = format(to, "yyyy-MM-dd");
  const periodLabel = isCustom ? `${format(from, "d MMM yyyy")} – ${format(to, "d MMM yyyy")}` : formatPeriodLabel(granularity, anchor);
  const periodQuery = isCustom ? `period=custom&from=${fromValue}&to=${toValue}` : `period=${granularity}&anchor=${anchorValue}`;
  const pdfHref = `/api/reports/management-dashboard-pdf?${periodQuery}`;
  const leadsActivityPdfHref = `/api/reports/leads-activity-pdf?${periodQuery}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Manager Dashboard"
        description="Team performance and onboarding pipeline for the selected period."
        actions={
          <Button variant="outline" size="sm" render={<Link href={pdfHref} />}>
            Download PDF
          </Button>
        }
      />

      <AiSummaryCard
        kind="management"
        period={isCustom ? { period: "custom", from: fromValue, to: toValue } : { period: granularity, anchor: anchorValue }}
        label="Summarize this period"
      />

      <PeriodPicker
        granularity={granularity}
        anchor={anchorValue}
        label={periodLabel}
        canGoNext={to < now}
        isCustom={isCustom}
        fromValue={fromValue}
        toValue={toValue}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total Leads" value={totalLeads} />
        <StatCard label="Active for Onboarding" value={activeClients} />
        <StatCard label="On-Hold" value={onHoldClients} tone={onHoldClients > 0 ? "warning" : "default"} />
        <StatCard label="Completed" value={completedClients} tone="success" />
        <StatCard label="Avg Onboarding Time" value={avgOnboardingDays > 0 ? `${avgOnboardingDays}d` : "—"} />
        <StatCard label="SLA Compliance" value={`${slaCompliance}%`} tone={slaCompliance < 80 ? "warning" : "success"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pipeline View</CardTitle>
          <p className="text-sm text-muted-foreground">
            Clients created in the selected period, grouped by current stage. Click a stage to see the full client
            list. ₹ potential per stage will appear here once Opportunity Management ships.
          </p>
        </CardHeader>
        <CardContent>
          {funnelData.length === 0 ? (
            <EmptyState
              icon={Workflow}
              title="No pipeline stages configured"
              description="Add your onboarding stages in Settings → Stages to see the pipeline."
              action={session.user.role === "ADMIN" ? { label: "Go to Stages", href: "/settings/stages" } : undefined}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead>Clients</TableHead>
                  <TableHead>Conversion %</TableHead>
                  <TableHead>Avg Time in Stage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {funnelData.map((row) => {
                  const conversion = conversionByStageId.get(row.stageId);
                  const duration = stageDurationByStageId.get(row.stageId);
                  return (
                    <TableRow key={row.stageId}>
                      <TableCell className="text-sm">
                        <Link
                          href={row.stageId === LOST_STAGE_ID ? "/clients?status=NOT_PROCEEDING" : `/clients?stage=${row.stageId}`}
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {row.stage}
                        </Link>
                      </TableCell>
                      <TableCell>{row.count}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{conversion ? `${conversion.pct}%` : "—"}</TableCell>
                      <TableCell className={duration ? thresholdTone(duration.avgHours, 72) : ""}>
                        {duration ? (duration.avgHours < 24 ? `${Math.round(duration.avgHours)}h` : `${Math.round((duration.avgHours / 24) * 10) / 10}d`) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <LeadsActivitySection
        searchParams={params}
        clientWhere={clientFilter}
        overrideRange={{ from, to, granularity: granularityForPeriod(granularity) }}
        exportHref={leadsActivityPdfHref}
      />

      <Card>
        <CardHeader>
          <CardTitle>Team &amp; RM Performance</CardTitle>
          <p className="text-sm text-muted-foreground">
            SLA % and Overdue Tasks are always current, regardless of the selected period. Active, Completed, On-Hold,
            and Avg Onboarding Days are scoped to clients created in the selected period. Everything else is activity
            within the selected period.
          </p>
          <AiSummaryCard
            kind="rm_overall"
            period={isCustom ? { period: "custom", from: fromValue, to: toValue } : { period: granularity, anchor: anchorValue }}
            label="Summarize RM performance"
          />
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>RM</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>On-Hold</TableHead>
                  <TableHead>SLA %</TableHead>
                  <TableHead>Overdue Tasks</TableHead>
                  <TableHead>Avg Onboarding Days</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Leads Assigned</TableHead>
                  <TableHead>Clients Contacted</TableHead>
                  <TableHead>Meetings</TableHead>
                  <TableHead>Follow-ups Done</TableHead>
                  <TableHead>KYC Completed</TableHead>
                  <TableHead>Funds Received</TableHead>
                  <TableHead>Investments Executed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rmPerformance.map((row) => {
                  const activity = activityByRm.get(row.rm.id);
                  return (
                    <TableRow key={row.rm.id}>
                      <TableCell className="text-sm font-medium">
                        <Link href={`/reports/rm/${row.rm.id}`} className="text-primary underline">
                          {row.rm.name}
                        </Link>
                      </TableCell>
                      <TableCell>{row.active}</TableCell>
                      <TableCell>{row.completed}</TableCell>
                      <TableCell className={thresholdTone(row.onHold, 5)}>{row.onHold}</TableCell>
                      <TableCell className={thresholdTone(100 - row.rmSlaPct, 20)}>{row.rmSlaPct}%</TableCell>
                      <TableCell className={thresholdTone(row.overdueTasks, 3)}>{row.overdueTasks}</TableCell>
                      <TableCell>{row.rmAvgDays > 0 ? `${row.rmAvgDays}d` : "—"}</TableCell>
                      <TableCell>{row.rm.capacity ?? "—"}</TableCell>
                      <TableCell>{activity?.leadsAssigned ?? 0}</TableCell>
                      <TableCell>{activity?.clientsContacted ?? 0}</TableCell>
                      <TableCell>{activity?.meetingsCompleted ?? 0}</TableCell>
                      <TableCell>{activity?.followUpsCompleted ?? 0}</TableCell>
                      <TableCell>{activity?.kycCompleted ?? 0}</TableCell>
                      <TableCell>{formatInr(activity?.fundsReceived ?? 0)}</TableCell>
                      <TableCell>{activity?.investmentsExecuted ?? 0}</TableCell>
                    </TableRow>
                  );
                })}
                {rmPerformance.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={15} className="text-center text-muted-foreground py-6">
                      No RMs to report on yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Wealth Health Checkups, Smart Allvest completions, and AUM added will appear here once the Wealth Workspace ships.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
