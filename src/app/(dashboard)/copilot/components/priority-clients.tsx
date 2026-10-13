import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { Users } from "lucide-react";
import { loadPriorityClients } from "@/lib/priority/load";

const TIER_VARIANT = { High: "destructive", Medium: "secondary", Low: "outline" } as const;

/**
 * Priority clients (bible section 07): who to contact, what to discuss, why. Shown on the Co-pilot only when
 * NEXT_PUBLIC_RM_PRIORITY_CLIENTS is on. Reuses the Co-pilot's existing card, table, badge and empty-state components.
 */
export async function PriorityClients({ visibleUserIds, includeUnassigned }: { visibleUserIds: string[] | null; includeUnassigned: boolean }) {
  const rows = await loadPriorityClients(visibleUserIds, includeUnassigned);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Priority clients</CardTitle>
        <CardDescription>Customers who need attention, ranked High, Medium or Low. Each shows why, what to discuss and what they accept.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState icon={Users} title="No customers need attention" description="Nothing is open for your customers right now." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Next best action</TableHead>
                <TableHead>Talking points</TableHead>
                <TableHead>Accepts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.clientId}>
                  <TableCell>
                    <Link href={`/clients/${row.clientId}`} className="font-medium text-primary underline-offset-2 hover:underline">
                      {row.rank}. {row.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{row.lifecycleStage}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={TIER_VARIANT[row.tier]}>{row.tier}</Badge>
                    <p className="max-w-64 whitespace-normal pt-1 text-xs text-muted-foreground">{row.reason}</p>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-medium">{row.nbaProgramme}</span>
                    <p className="text-xs text-muted-foreground">{row.nbaAction}{row.nbaTopic ? ` · ${row.nbaTopic}` : ""}</p>
                    <p className="max-w-72 whitespace-normal text-xs text-muted-foreground">{row.nbaReason}</p>
                  </TableCell>
                  <TableCell className="max-w-72 whitespace-normal text-sm">
                    {row.talkingPoints.length === 0 ? <span className="text-muted-foreground">None</span> : (
                      <ul className="list-disc pl-4 text-xs text-muted-foreground">
                        {row.talkingPoints.map((point) => <li key={point}>{point}</li>)}
                      </ul>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{row.highAcceptance.length === 0 ? <span className="text-muted-foreground">No high acceptance</span> : row.highAcceptance.join(", ")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
