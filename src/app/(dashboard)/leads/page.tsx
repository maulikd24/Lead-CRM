import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewLeadDialog } from "./new-lead-dialog";
import { formatDate } from "@/lib/utils/format";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  NEW: "outline",
  CONTACTED: "secondary",
  QUALIFIED: "default",
  CONVERTED: "default",
  LOST: "destructive",
  JUNK: "destructive",
};

export default async function LeadsPage() {
  const session = await requireUser();
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);

  const [leads, users] = await Promise.all([
    prisma.lead.findMany({
      where: visibleUserIds ? { assignedToId: { in: visibleUserIds } } : undefined,
      include: { assignedTo: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Leads</CardTitle>
        <NewLeadDialog users={users} />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Assigned To</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => (
              <TableRow key={lead.id}>
                <TableCell>
                  <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
                    {lead.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {lead.email ?? lead.phone ?? "—"}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">{lead.source ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[lead.status]}>{lead.status}</Badge>
                </TableCell>
                <TableCell className="text-sm">{lead.assignedTo?.name ?? "Unassigned"}</TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDate(lead.createdAt)}
                </TableCell>
              </TableRow>
            ))}
            {leads.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No leads yet. Create your first lead to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
