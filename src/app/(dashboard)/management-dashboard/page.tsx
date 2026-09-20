import Link from "next/link";
import { Workflow } from "lucide-react";

import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { getReportsPageData } from "@/lib/reports/get-reports-page-data";
import { getTeamActivityRows } from "@/lib/reports/team-performance";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { thresholdTone } from "@/lib/report-tone";
import type { Prisma } from "@/generated/prisma/client";

type ManagementDashboardSearchParams = { from?: string; to?: string };

function formatInr(amount: number) {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

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

  const to = params.to ? new Date(`${params.to}T23:59:59.999`) : now;
  const from = params.from ? new Date(`${params.from}T00:00:00`) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  const { funnelData, rmPerformance } = await getReportsPageData(clientFilter, visibleUserIds, now);
  const activityByRm = await getTeamActivityRows(
    rmPerformance.map((row) => row.rm.id),
    { from, to },
  );

  const fromValue = from.toISOString().slice(0, 10);
  const toValue = to.toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Manager Dashboard" description="Team performance and onboarding pipeline for the selected period." />

      <Card>
        <CardContent className="pt-6">
          <form className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="from">
                From
              </label>
              <Input id="from" name="from" type="date" defaultValue={fromValue} className="w-40" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="to">
                To
              </label>
              <Input id="to" name="to" type="date" defaultValue={toValue} className="w-40" />
            </div>
            <Button type="submit" size="sm">
              Apply
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Team Performance</CardTitle>
          <p className="text-sm text-muted-foreground">
            Active/Completed/SLA % are as of now. Everything else is scoped to the selected date range.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>RM</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>SLA %</TableHead>
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
                      <TableCell className={thresholdTone(100 - row.rmSlaPct, 20)}>{row.rmSlaPct}%</TableCell>
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
                    <TableCell colSpan={11} className="text-center text-muted-foreground py-6">
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

      <Card>
        <CardHeader>
          <CardTitle>Pipeline View</CardTitle>
          <p className="text-sm text-muted-foreground">
            Client counts per onboarding stage, as of now. ₹ potential per stage will appear here once Opportunity Management
            ships.
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {funnelData.map((row) => (
                  <TableRow key={row.stageId}>
                    <TableCell className="text-sm">{row.stage}</TableCell>
                    <TableCell>{row.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
