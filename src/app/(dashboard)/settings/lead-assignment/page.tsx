import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getAssignmentSettings } from "@/lib/assignment/settings";
import { getEligibleRms, nextInRotation } from "@/lib/assignment/routing-engine";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ModeForm } from "./mode-form";

export default async function LeadAssignmentPage() {
  await requireRole(["ADMIN"]);
  const settings = await getAssignmentSettings();

  const [rms, pool, unassignedCount] = await Promise.all([
    prisma.user.findMany({
      where: { role: "RM", isActive: true },
      select: { id: true, name: true, capacity: true, availabilityStatus: true },
      orderBy: { name: "asc" },
    }),
    getEligibleRms({}),
    prisma.client.count({ where: { assignedToId: null, isDeleted: false, mergedIntoId: null, status: "ACTIVE" } }),
  ]);
  const activeCounts = await prisma.client.groupBy({
    by: ["assignedToId"],
    where: { assignedToId: { in: rms.map((r) => r.id) }, status: "ACTIVE", mergedIntoId: null, isDeleted: false },
    _count: { _all: true },
  });
  const countByRm = new Map(activeCounts.map((row) => [row.assignedToId, row._count._all]));
  const eligibleIds = new Set(pool.map((r) => r.id));
  const nextUp = settings.mode === "ROUND_ROBIN" ? nextInRotation(pool, settings.roundRobinCursorId) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Lead Assignment" description="How new leads are assigned to RMs — manual entry, imports and inbound leads all follow this." />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Assignment mode</CardTitle>
          <CardDescription>
            Availability, region, language and HNI rules apply to both automatic modes. Choosing an RM when creating a lead always wins.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ModeForm current={settings.mode} />
        </CardContent>
      </Card>

      {settings.mode === "MANUAL" && (
        <Card className="max-w-2xl border-warning/40 bg-warning/5">
          <CardContent className="text-sm">
            <b>{unassignedCount}</b> active lead{unassignedCount === 1 ? " is" : "s are"} unassigned right now. Admins and Managers can find them under Clients →
            Assigned RM → <i>Unassigned</i>.
          </CardContent>
        </Card>
      )}

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">RM pool</CardTitle>
          <CardDescription>Who an automatic mode can pick from right now (before a lead&apos;s own region/language/HNI needs).</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>RM</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead>Active clients</TableHead>
                <TableHead>In pool</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody striped>
              {rms.map((rm) => (
                <TableRow key={rm.id}>
                  <TableCell className="text-sm">{rm.name}</TableCell>
                  <TableCell className="text-sm">{rm.availabilityStatus.replace(/_/g, " ").toLowerCase()}</TableCell>
                  <TableCell className="text-sm">
                    {countByRm.get(rm.id) ?? 0} / {rm.capacity ?? 50}
                  </TableCell>
                  <TableCell>
                    {eligibleIds.has(rm.id) ? <Badge variant="success">Yes</Badge> : <Badge variant="outline">No</Badge>}
                    {nextUp?.id === rm.id && <Badge className="ml-2">Next up</Badge>}
                  </TableCell>
                </TableRow>
              ))}
              {rms.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                    No active RMs yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
