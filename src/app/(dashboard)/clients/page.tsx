import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NewClientDialog } from "./new-client-dialog";
import { formatDate } from "@/lib/utils/format";
import { computeSlaStatus, stageAgeHours } from "@/lib/stage-engine/sla-status";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ACTIVE: "default",
  ON_HOLD: "secondary",
  COMPLETED: "default",
  NOT_PROCEEDING: "destructive",
};

const PRIORITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  HIGH: "destructive",
  MEDIUM: "secondary",
  LOW: "outline",
};

const SLA_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ON_TRACK: "default",
  DUE_SOON: "secondary",
  OVERDUE: "destructive",
  NOT_APPLICABLE: "outline",
};

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireUser();
  const { q } = await searchParams;
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);

  const [clients, users] = await Promise.all([
    prisma.client.findMany({
      where: {
        ...(visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { mobile: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                { clientCode: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: { assignedTo: true, currentStage: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Clients</CardTitle>
        <div className="flex items-center gap-2">
          <form>
            <Input name="q" defaultValue={q} placeholder="Search name, mobile, email, client ID..." className="w-72" />
          </form>
          <NewClientDialog users={users} />
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Stage Age</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>SLA Status</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Assigned RM</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((client) => {
              const ageHours = stageAgeHours(client.stageEnteredAt);
              const slaStatus = computeSlaStatus(client.stageEnteredAt, client.currentStage.slaHours);
              return (
                <TableRow key={client.id}>
                  <TableCell>
                    <Link href={`/clients/${client.id}`} className="font-medium hover:underline">
                      {client.name}
                    </Link>
                    <p className="text-xs text-muted-foreground font-mono">{client.clientCode}</p>
                  </TableCell>
                  <TableCell className="text-sm">{client.mobile}</TableCell>
                  <TableCell className="text-sm">{client.currentStage.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {ageHours < 24 ? `${Math.round(ageHours)}h` : `${Math.round(ageHours / 24)}d`}
                  </TableCell>
                  <TableCell>
                    <Badge variant={PRIORITY_VARIANT[client.priority]}>{client.priority}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={SLA_VARIANT[slaStatus]}>{slaStatus.replace(/_/g, " ")}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[client.status]}>{client.status.replace(/_/g, " ")}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{client.assignedTo?.name ?? "Unassigned"}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{formatDate(client.createdAt)}</TableCell>
                </TableRow>
              );
            })}
            {clients.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  No clients yet. Create your first client to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
