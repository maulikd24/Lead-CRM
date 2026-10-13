import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { Users } from "lucide-react";
import { loadPriorityClients, type PriorityClientRow } from "@/lib/priority/load";

const TIER_VARIANT = { High: "destructive", Medium: "secondary", Low: "outline" } as const;

/** The RM's view inside one customer: snapshot, last interaction, commitments, every acceptance level, next action, talking points and what to avoid. */
function PriorityDetailPanel({ row }: { row: PriorityClientRow }) {
  const d = row.detail;
  return (
    <details className="pt-2 text-xs">
      <summary className="cursor-pointer text-primary underline-offset-2 hover:underline">Details</summary>
      <div className="mt-2 space-y-2 text-muted-foreground">
        <section>
          <p className="font-medium text-foreground">Snapshot</p>
          <p>{d.snapshot.lifecycleStage} · {d.snapshot.segment}{d.snapshot.segments.length > 0 ? ` · ${d.snapshot.segments.join(", ")}` : ""}</p>
          <p>RM: {d.snapshot.assignedTo ?? "Unassigned"}</p>
        </section>
        <section>
          <p className="font-medium text-foreground">Recent interaction</p>
          <p>{d.lastInteraction}</p>
        </section>
        <section>
          <p className="font-medium text-foreground">Pending commitments</p>
          {d.commitments.length === 0 ? <p>None</p> : (
            <ul className="list-disc pl-4">
              {d.commitments.map((c) => (
                <li key={`${c.text}-${c.dueAtIso}`}>{c.text}{c.dueAtIso ? ` · due ${c.dueAtIso.slice(0, 10)}${c.overdue ? " (overdue)" : ""}` : ""}</li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <p className="font-medium text-foreground">Acceptance by asset class</p>
          <ul className="list-disc pl-4">
            {d.acceptance.map((a) => (
              <li key={a.assetClass}>{a.assetClass}: {a.level.charAt(0) + a.level.slice(1).toLowerCase()}</li>
            ))}
          </ul>
        </section>
        <section>
          <p className="font-medium text-foreground">Next best action</p>
          <p>{d.nba.programme} · {d.nba.action}{d.nba.topic ? ` · ${d.nba.topic}` : ""}</p>
          <p>{d.nba.reason}</p>
        </section>
        <section>
          <p className="font-medium text-foreground">Talking points{d.talkingPointsSource === "ai" ? " (AI rewrite)" : ""}</p>
          <ul className="list-disc pl-4">
            {d.talkingPoints.map((point) => <li key={point}>{point}</li>)}
          </ul>
        </section>
        <section>
          <p className="font-medium text-foreground">Do not discuss</p>
          {d.doNotDiscuss.length === 0 ? <p>Nothing set aside</p> : (
            <ul className="list-disc pl-4">
              {d.doNotDiscuss.map((item) => <li key={item}>{item}</li>)}
            </ul>
          )}
        </section>
      </div>
    </details>
  );
}

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
                    <PriorityDetailPanel row={row} />
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
