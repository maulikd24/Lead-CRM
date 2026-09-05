import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { StageRow } from "./stage-row";

export default async function StagesSettingsPage() {
  await requireRole(["ADMIN"]);

  const stages = await prisma.stage.findMany({ where: { isActive: true }, orderBy: { sequence: "asc" } });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Onboarding Stages"
        description="The 5-step onboarding sequence is fixed — only SLA hours and active status can be tuned here."
      />
      <Card>
        <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>SLA (hours)</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody striped>
            {stages.map((stage) => (
              <StageRow key={stage.id} stage={stage} />
            ))}
          </TableBody>
        </Table>
        </CardContent>
      </Card>
    </div>
  );
}
