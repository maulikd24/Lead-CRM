import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { getManagerAttentionRows } from "@/lib/dashboard/manager-attention";
import { formatStageAge } from "@/lib/utils/format";
import { ExceptionRowActions } from "./exception-row-actions";

const CATEGORY_LABEL: Record<string, string> = {
  sla_breach: "SLA Breach",
  high_priority_overdue: "High Priority",
  kyc_rejection: "KYC Rejection",
  no_next_action: "No Next Action",
  repeated_failed_contact: "Repeated Failed Contact",
  unresolved_exception: "Unresolved Blocker",
  stage_corrected: "Recent Stage Correction",
};

export default async function ExceptionsPage() {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);

  const [rows, users] = await Promise.all([
    getManagerAttentionRows(visibleUserIds),
    prisma.user.findMany({ where: { isActive: true, role: { in: ["RM", "MANAGER"] } }, orderBy: { name: "asc" } }),
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Exceptions</CardTitle>
        <CardDescription>
          Everything needing manager intervention — SLA breaches, stuck clients, KYC rejections, missing next
          actions, repeated failed contacts, unresolved blockers, and recent manual stage corrections.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>RM</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Blocker</TableHead>
                <TableHead>Stage Age</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Recommended Action</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={`${row.clientId}-${row.category}-${i}`}>
                  <TableCell className="text-sm font-medium">
                    {row.clientName}
                    <p className="text-xs text-muted-foreground font-mono">{row.clientCode}</p>
                  </TableCell>
                  <TableCell className="text-sm">{row.rmName ?? "Unassigned"}</TableCell>
                  <TableCell className="text-sm">{row.stageName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.blockerReason ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatStageAge(row.ageHours)}</TableCell>
                  <TableCell>
                    <Badge variant="destructive">{CATEGORY_LABEL[row.category] ?? row.category}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-56">{row.recommendedAction}</TableCell>
                  <TableCell>
                    <ExceptionRowActions
                      clientId={row.clientId}
                      rmId={row.rmId}
                      recommendedAction={row.recommendedAction}
                      users={users}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    Nothing needs attention right now.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
