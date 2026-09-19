import Link from "next/link";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { thresholdTone } from "@/lib/report-tone";
import type { RmPerformanceRow } from "@/lib/reports/rm-performance";

/** Shared by the Reports page and the Executive Dashboard — one RM Performance table, one place
 * the columns/thresholds are defined. */
export function RmPerformanceTable({ rows }: { rows: RmPerformanceRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>RM</TableHead>
          <TableHead>Active</TableHead>
          <TableHead>Completed</TableHead>
          <TableHead>Overdue Tasks</TableHead>
          <TableHead>SLA %</TableHead>
          <TableHead>Avg Onboarding Days</TableHead>
          <TableHead>Capacity</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ rm, active, completed, overdueTasks, rmSlaPct, rmAvgDays }) => (
          <TableRow key={rm.id}>
            <TableCell className="font-medium">
              <Link href={`/reports/rm/${rm.id}`} className="text-primary underline-offset-2 hover:underline">
                {rm.name}
              </Link>
            </TableCell>
            <TableCell>
              {active}
              {rm.capacity ? <span className="text-muted-foreground">/{rm.capacity}</span> : null}
            </TableCell>
            <TableCell>{completed}</TableCell>
            <TableCell className={thresholdTone(overdueTasks, 1)}>{overdueTasks}</TableCell>
            <TableCell className={rmSlaPct < 80 ? "text-destructive font-medium" : ""}>{rmSlaPct}%</TableCell>
            <TableCell>{rmAvgDays > 0 ? `${rmAvgDays}d` : "—"}</TableCell>
            <TableCell className="text-muted-foreground">{rm.capacity ?? "—"}</TableCell>
          </TableRow>
        ))}
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
              No RMs to report on yet.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
