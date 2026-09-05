import Link from "next/link";
import { Sparkles } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge, type badgeVariants } from "@/components/ui/badge";
import { CopilotQuickActions } from "@/components/copilot/quick-actions";
import { EmptyState } from "@/components/shared/empty-state";
import { TableRowSkeleton } from "@/components/shared/skeletons";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";
import type { WorklistEntry } from "@/lib/copilot/worklist";

const HEALTH_VARIANT: Record<string, NonNullable<VariantProps<typeof badgeVariants>["variant"]>> = {
  HEALTHY: "success",
  AT_RISK: "warning",
  CRITICAL: "destructive",
};

function scoreTone(score: number): string {
  if (score >= 80) return "text-destructive";
  if (score >= 50) return "text-warning";
  return "text-muted-foreground";
}

function propensityTone(score: number): string {
  if (score >= 70) return "text-success";
  if (score >= 40) return "text-warning";
  return "text-muted-foreground";
}

export function CopilotWorklist({
  entries,
  users,
}: {
  entries: WorklistEntry[];
  users: { id: string; name: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Prioritized Worklist</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Health</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Propensity</TableHead>
              <TableHead>Next Best Action</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody striped>
            {entries.map((entry) => (
              <TableRow key={entry.client.id}>
                <TableCell className="text-sm">
                  <Link href={`/clients/${entry.client.id}`} className="font-medium hover:underline">
                    {entry.client.name}
                  </Link>
                  <p className="text-xs text-muted-foreground font-mono">{entry.client.clientCode}</p>
                </TableCell>
                <TableCell className="text-sm">{entry.client.stageName}</TableCell>
                <TableCell>
                  <Badge variant={HEALTH_VARIANT[entry.health.status]}>{entry.health.status.replace("_", " ")}</Badge>
                  {entry.health.reasons[0] && (
                    <p className="text-xs text-muted-foreground mt-0.5">{entry.health.reasons[0]}</p>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  <span className={cn("font-heading font-semibold tabular-nums", scoreTone(entry.priority.score))}>
                    {entry.priority.score}
                  </span>
                  {entry.priority.reasons[0] && (
                    <p className="text-xs text-muted-foreground">{entry.priority.reasons[0]}</p>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  <span className={cn("font-heading font-semibold tabular-nums", propensityTone(entry.propensity.score))}>
                    {entry.propensity.score}
                  </span>
                  {entry.propensity.reasons[0] && (
                    <p className="text-xs text-muted-foreground">{entry.propensity.reasons[0]}</p>
                  )}
                </TableCell>
                <TableCell className="text-sm max-w-56">
                  <p>{entry.nba.label}</p>
                  <p className="text-xs text-muted-foreground">{entry.nba.detail}</p>
                </TableCell>
                <TableCell>
                  <CopilotQuickActions
                    clientId={entry.client.id}
                    assignedToId={entry.client.assignedToId}
                    suggestedFollowUp={entry.suggestedFollowUp}
                    messageSuggestion={entry.messageSuggestion}
                    users={users}
                  />
                </TableCell>
              </TableRow>
            ))}
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <EmptyState icon={Sparkles} title="Nothing needs attention" description="You're all caught up." />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function CopilotWorklistSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Prioritized Worklist</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableBody>
            {Array.from({ length: 6 }).map((_, i) => (
              <TableRowSkeleton key={i} columns={7} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
