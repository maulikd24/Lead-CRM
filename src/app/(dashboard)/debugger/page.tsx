import { Bug } from "lucide-react";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDateTime } from "@/lib/utils/format";
import { DebuggerRowActions } from "./debugger-row-actions";

export default async function DebuggerPage() {
  await requireRole(["ADMIN"]);

  const reports = await prisma.bugReport.findMany({
    include: { reportedBy: { select: { name: true } }, resolvedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Debugger"
        description="Issues reported by anyone using the app, newest first — resolve them here."
      />
      <Card>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reported By</TableHead>
                  <TableHead>Page</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reported At</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody striped>
                {reports.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell className="text-sm">{report.reportedBy.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{report.pageUrl}</TableCell>
                    <TableCell className="text-sm max-w-96 whitespace-normal">
                      {report.description}
                      {report.status === "RESOLVED" && report.resolutionNotes && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Resolved by {report.resolvedBy?.name}: {report.resolutionNotes}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={report.status === "OPEN" ? "destructive" : "success"}>{report.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(report.createdAt)}</TableCell>
                    <TableCell>{report.status === "OPEN" && <DebuggerRowActions bugReportId={report.id} />}</TableCell>
                  </TableRow>
                ))}
                {reports.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <EmptyState icon={Bug} title="No issues reported" description="Nothing's been flagged yet." />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
