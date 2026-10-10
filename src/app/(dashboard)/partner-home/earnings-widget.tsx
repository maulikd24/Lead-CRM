import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { getVisibleScope } from "@/lib/policy/visibility";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isPartnerWorkspaceEnabled } from "@/lib/partners/flag";
import { createNativePort, type NativeDb } from "@/lib/partners/native/queries";
import { resolveNativeScope, type ScopeDb } from "@/lib/partners/native/scope";
import { resolvePartnerSource } from "@/lib/partners/source";
import { inr, payoutBadge } from "@/lib/partners/native/view-models";
import { periodShort } from "@/lib/partners/native/format";
import type { Role } from "@/generated/prisma/client";

/**
 * Partner-facing, read-only earnings summary. It reads through the same data layer as the Partner workspace, narrowed to the
 * viewer's scope: a distributor sees their own network's totals, a partner their own, and a payout run that is still a draft is
 * counted ("N payout runs awaiting approval") but never listed. When the workspace is on, it links into its statements.
 */
export async function EarningsWidget({ actor }: { actor: { id: string; role: Role } }) {
  const scope = await resolveNativeScope(actor, { db: prisma as unknown as ScopeDb, visibleScope: getVisibleScope });
  if (!scope || (scope.kind === "ids" && scope.ids.length === 0)) return null;
  const port = createNativePort(prisma as unknown as NativeDb, scope, {});
  const [summary, extras, payouts] = await Promise.all([port.getSummary(), port.getOverviewExtras(), port.listPayouts({ limit: 5 })]);
  const workspace = isPartnerWorkspaceEnabled() && resolvePartnerSource() === "native";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">Earnings</CardTitle>
        {workspace && <Button size="sm" variant="outline" render={<Link href="/partners/statements" />}>Statements</Button>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Earned to Date" value={inr(String(summary.earnings.total ?? 0))} />
          <StatCard label={`Accrued in ${extras.accrualsThisMonth.label}`} value={inr(String(extras.accrualsThisMonth.amount))} />
          <StatCard label="Pending Payouts" value={inr(String(extras.pendingPayouts.amount))} />
        </div>
        {extras.hiddenRuns > 0 && <p role="note" className="text-xs text-muted-foreground">{extras.hiddenRuns} payout {extras.hiddenRuns === 1 ? "run" : "runs"} awaiting approval. You see a run once it is submitted for approval.</p>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>Net Payable</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody striped>
            {payouts.items.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="text-sm">{periodShort(p.runStart, p.runEnd)}</TableCell>
                <TableCell className="text-sm font-medium">{inr(p.net)}</TableCell>
                <TableCell>
                  <Badge variant={payoutBadge(p.status).tone === "success" ? "success" : "outline"}>{payoutBadge(p.status).label}</Badge>
                </TableCell>
              </TableRow>
            ))}
            {payouts.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                  No payouts on file yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
