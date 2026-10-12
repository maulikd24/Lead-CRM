import Link from "next/link";
import { Download } from "lucide-react";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils/format";
import { EXCLUDED_BY_DESIGN, EXPORT_TABLES } from "@/lib/data-export/tables";
import { MAX_DOWNLOADS } from "@/lib/data-export/limits";
import { RequestExportForm } from "./request-form";
import { ImportPanel } from "./import-panel";

type Status = { label: string; variant: "default" | "secondary" | "outline" | "destructive"; downloadable: boolean };

function statusOf(
  row: { approvedAt: Date | null; expiresAt: Date | null; downloadCount: number },
  approvalStatus: string | undefined,
  now: Date,
): Status {
  if (approvalStatus === "REJECTED") return { label: "Rejected", variant: "destructive", downloadable: false };
  if (!row.approvedAt) return { label: "Waiting for approval", variant: "secondary", downloadable: false };
  if (row.expiresAt && row.expiresAt <= now) return { label: "Expired", variant: "outline", downloadable: false };
  if (row.downloadCount >= MAX_DOWNLOADS) return { label: "Download limit reached", variant: "outline", downloadable: false };
  return { label: "Ready to download", variant: "default", downloadable: true };
}

export default async function DataExportPage() {
  const session = await requireRole(["ADMIN"]);
  const now = new Date();

  const [exports, otherAdmins] = await Promise.all([
    prisma.dataExport.findMany({ include: { requestedBy: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.user.count({ where: { role: "ADMIN", isActive: true, id: { not: session.user.id } } }),
  ]);
  const approvalIds = exports.map((e) => e.approvalRequestId).filter((id): id is string => !!id);
  const approvals = approvalIds.length
    ? await prisma.approvalRequest.findMany({ where: { id: { in: approvalIds } }, select: { id: true, status: true, decidedBy: { select: { name: true } } } })
    : [];
  const approvalById = new Map(approvals.map((a) => [a.id, a]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Data Export"
        description="Move every client and their full history in or out of Allvest Customer OS — for example to a new server or database. Exports need a second Admin's approval."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Request an export</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RequestExportForm disabledReason={otherAdmins === 0 ? "A second active Admin is needed to approve exports." : null} />
          <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">What you get</p>
            <p className="mt-1">
              One zip containing {EXPORT_TABLES.length} data files (clients, KYC, funding, notes and activity, messages, support tickets, call transcripts,
              tasks, opportunities, portfolio and payments, and the users and stages they refer to), plus spreadsheets of clients and a client timeline you can
              open in Excel. Once approved you have 24 hours and {MAX_DOWNLOADS} downloads. The file is built as it downloads — nothing is stored.
            </p>
            <p className="mt-2 font-medium text-foreground">What is not included</p>
            <ul className="mt-1 list-disc pl-5">
              {Object.entries(EXCLUDED_BY_DESIGN)
                .slice(0, 6)
                .map(([table, why]) => (
                  <li key={table}>
                    <span className="font-mono text-xs">{table}</span> — {why}
                  </li>
                ))}
              <li>…and {Math.max(Object.keys(EXCLUDED_BY_DESIGN).length - 6, 0)} more (such as journeys, templates, partner and commission data). Passwords and integration keys are never exported. The zip&apos;s manifest lists everything left out.</li>
            </ul>
            <p className="mt-2">
              To load the zip on the new server, run <code className="rounded bg-muted px-1 py-0.5 text-xs">npm run import:data -- path/to/export.zip</code> there.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import data into this Allvest Customer OS</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Load an export file made by another Allvest Customer OS (or an earlier copy of this one). The file is checked first and nothing changes until you confirm. Users, stages and products are matched to what
            is already here — by email, name and product code — instead of being duplicated, and the import is all-or-nothing. Nothing from the file is kept after the import.
          </p>
          <ImportPanel />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Exports</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Requested</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Decided by</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Downloads</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {exports.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                    No exports yet.
                  </TableCell>
                </TableRow>
              )}
              {exports.map((row) => {
                const approval = row.approvalRequestId ? approvalById.get(row.approvalRequestId) : undefined;
                const status = statusOf(row, approval?.status, now);
                const mine = row.requestedById === session.user.id;
                return (
                  <TableRow key={row.id}>
                    <TableCell>{formatDateTime(row.createdAt)}</TableCell>
                    <TableCell>{row.requestedBy.name}</TableCell>
                    <TableCell className="max-w-64 whitespace-normal text-sm">{row.reason}</TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                    <TableCell>{approval?.decidedBy?.name ?? "—"}</TableCell>
                    <TableCell>{row.expiresAt ? formatDateTime(row.expiresAt) : "—"}</TableCell>
                    <TableCell>
                      {row.downloadCount}/{MAX_DOWNLOADS}
                    </TableCell>
                    <TableCell>
                      {status.downloadable && mine && (
                        <Button size="sm" variant="outline" render={<Link href={`/api/data-export/${row.id}/download`} prefetch={false} />}>
                          <Download className="size-4" /> Download
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
