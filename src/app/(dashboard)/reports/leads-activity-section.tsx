import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/shared/stat-card";
import { getLeadsActivity, parseLeadsActivityParams } from "@/lib/reports/leads-activity";
import { LeadsActivityFilters } from "./leads-activity-filters";
import { LeadsActivityChartLoader } from "./leads-activity-chart-loader";
import type { Prisma } from "@/generated/prisma/client";

/** Reused as-is by the Reports page (unscoped, per your visibility) and the RM detail page
 * (scoped to one RM via clientWhere + csvExtraParams) — one chart/filter/CSV implementation. */
export async function LeadsActivitySection({
  searchParams,
  clientWhere,
  csvExtraParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
  clientWhere?: Prisma.ClientWhereInput;
  csvExtraParams?: Record<string, string>;
}) {
  const now = new Date();
  const { granularity, from, to } = parseLeadsActivityParams(searchParams, now);
  const buckets = await getLeadsActivity({ from, to, granularity, clientWhere });

  const totalCreated = buckets.reduce((sum, b) => sum + b.created, 0);
  const totalUpdated = buckets.reduce((sum, b) => sum + b.updated, 0);
  const chartData = buckets.map((b) => ({ label: b.label, created: b.created, updated: b.updated }));

  // Forward exactly what's currently on screen — the CSV route parses these with the same
  // parseLeadsActivityParams(), so the download always matches the chart.
  const rawGranularity = typeof searchParams.laGranularity === "string" ? searchParams.laGranularity : undefined;
  const rawFrom = typeof searchParams.laFrom === "string" ? searchParams.laFrom : undefined;
  const rawTo = typeof searchParams.laTo === "string" ? searchParams.laTo : undefined;

  const csvParams = new URLSearchParams();
  if (rawGranularity) csvParams.set("laGranularity", rawGranularity);
  if (rawGranularity === "custom" && rawFrom && rawTo) {
    csvParams.set("laFrom", rawFrom);
    csvParams.set("laTo", rawTo);
  }
  if (csvExtraParams) {
    for (const [key, value] of Object.entries(csvExtraParams)) csvParams.set(key, value);
  }
  const csvHref = `/api/reports/leads-summary?${csvParams.toString()}`;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Leads Activity</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Created counts new clients in the period. Updated counts any change to the client record itself — stage
            advances, status/hold changes, reassignment, and direct edits. Document, KYC, and funding sub-record
            changes that don&apos;t also touch the client aren&apos;t counted.
          </p>
        </div>
        <Button variant="outline" size="sm" render={<Link href={csvHref} />}>
          Download CSV
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <LeadsActivityFilters />
        <div className="grid grid-cols-2 gap-3 sm:w-80">
          <StatCard label="Created" value={totalCreated} />
          <StatCard label="Updated" value={totalUpdated} />
        </div>
        <LeadsActivityChartLoader data={chartData} />
      </CardContent>
    </Card>
  );
}
