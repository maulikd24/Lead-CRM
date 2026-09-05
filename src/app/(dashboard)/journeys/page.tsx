import Link from "next/link";
import { Workflow } from "lucide-react";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDateTime } from "@/lib/utils/format";
import { NewJourneyDialog } from "./new-journey-dialog";
import { JourneyRowActions } from "./journey-row-actions";

export default async function JourneysPage() {
  await requireRole(["ADMIN", "MANAGER"]);

  const journeys = await prisma.journey.findMany({
    include: {
      _count: { select: { runs: true } },
      runs: { where: { status: { in: ["RUNNING", "WAITING"] } }, select: { id: true }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Journeys" description="Automated stage-based workflows for onboarding clients." actions={<NewJourneyDialog />} />
      <Card>
        <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Enrolled Clients</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody striped>
            {journeys.map((journey) => (
              <TableRow key={journey.id}>
                <TableCell>
                  <Link href={`/journeys/${journey.id}`} className="font-medium hover:underline">
                    {journey.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={journey.isActive ? "success" : "outline"}>
                    {journey.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{journey._count.runs}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDateTime(journey.updatedAt)}
                </TableCell>
                <TableCell className="text-right">
                  <JourneyRowActions
                    journeyId={journey.id}
                    journeyName={journey.name}
                    runCount={journey._count.runs}
                    hasInFlightRuns={journey.runs.length > 0}
                  />
                </TableCell>
              </TableRow>
            ))}
            {journeys.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <EmptyState
                    icon={Workflow}
                    title="No journeys yet"
                    description="Create one to define how new clients move through your process."
                  />
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
