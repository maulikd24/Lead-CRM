import Link from "next/link";

import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { getQuarterScoreboard } from "@/lib/targets/scoreboard";
import { parseQuarterKey, quarterOf, shiftQuarter } from "@/lib/targets/quarter";
import { formatInrCompact } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TargetInput } from "./target-row";

export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ quarter?: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const current = quarterOf(new Date());
  const choices = [shiftQuarter(current, -1), current, shiftQuarter(current, 1)];
  const quarter = parseQuarterKey((await searchParams).quarter) ?? current;
  const s = await getQuarterScoreboard({ id: session.user.id, role: session.user.role }, visibleUserIds, quarter);
  const rows = s.leaderboard.kind === "team" ? [...s.leaderboard.rows].sort((a, b) => a.name.localeCompare(b.name)) : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Targets"
        description="Each RM's funded-amount target for the quarter. The team's target is the sum of its RMs'. Progress counts funding recorded as Partially or Fully Funded with a funding date in the quarter."
      />
      <nav aria-label="Quarter" className="flex w-fit items-center gap-1 rounded-md border border-border p-0.5">
        {choices.map((q) => (
          <Link
            key={q.key}
            href={`/settings/targets?quarter=${q.key}`}
            aria-current={q.key === quarter.key ? "page" : undefined}
            className={cn(
              "rounded px-3 py-1.5 text-xs font-semibold transition-colors",
              q.key === quarter.key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {q.label}
            {q.key === current.key ? " (now)" : ""}
          </Link>
        ))}
      </nav>
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">{quarter.label}</CardTitle>
          <CardDescription>
            {s.target > 0 ? `${formatInrCompact(s.funded)} funded of ${formatInrCompact(s.target)} (${s.progress.pct}%).` : `${formatInrCompact(s.funded)} funded, no targets set yet.`} Changes are recorded in the audit log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>RM</TableHead>
                <TableHead className="text-right">Funded so far</TableHead>
                <TableHead className="text-right">Target (₹)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.rmId}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatInrCompact(r.funded)}
                    {r.target > 0 && <span className="text-xs text-muted-foreground"> · {Math.round((r.funded / r.target) * 100)}%</span>}
                  </TableCell>
                  <TableCell>
                    <TargetInput key={`${r.rmId}:${quarter.key}`} rmId={r.rmId} rmName={r.name} quarterKey={quarter.key} current={r.target} />
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                    No active RMs in your team.
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
