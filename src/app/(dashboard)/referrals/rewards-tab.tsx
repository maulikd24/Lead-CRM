import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EVENT_LABEL, type ReferralEventType } from "@/lib/referrals/state-machine";
import { formatRupees } from "@/lib/referrals/summary";
import { FLAG_TEXT, type AccrualState, type LedgerRow } from "@/lib/referrals/views";

import { LedgerButtons } from "./controls";

const STATE: Record<AccrualState, { label: string; variant: "success" | "warning" | "outline" | "secondary" | "destructive" }> = {
  NEEDS_REVIEW: { label: "Needs review", variant: "warning" },
  ACCRUED: { label: "Accrued", variant: "secondary" },
  APPROVED: { label: "Approved", variant: "success" },
  PAID: { label: "Marked paid", variant: "success" },
  REVERSED: { label: "Reversed", variant: "outline" },
  CLAWED_BACK: { label: "Taken back", variant: "destructive" },
};
const day = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export function RewardsTab({ rows, total, canAct }: { rows: LedgerRow[]; total: number; canAct: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No rewards yet. They appear here when a referred person reaches a step that one of your active rules pays on.</p>;
  const review = rows.filter((r) => r.state === "NEEDS_REVIEW").length;
  return (
    <div className="flex flex-col gap-3">
      {review > 0 && <p role="status" className="text-sm"><Badge variant="warning">{review} to review</Badge> <span className="text-muted-foreground">These are held back from statements until someone clears or reverses them.</span></p>}
      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Referrer</TableHead>
              <TableHead className="hidden sm:table-cell">Referred customer</TableHead>
              <TableHead className="hidden sm:table-cell">Step</TableHead>
              <TableHead className="hidden md:table-cell">Rule</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="hidden sm:table-cell">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.referrerName}<span className="block text-xs text-muted-foreground sm:hidden">{r.event ? (EVENT_LABEL[r.event as ReferralEventType] ?? r.event) : ""}</span></TableCell>
                <TableCell className="hidden tabular-nums sm:table-cell">{r.referredCode ?? "Removed"}</TableCell>
                <TableCell className="hidden sm:table-cell">{r.event ? (EVENT_LABEL[r.event as ReferralEventType] ?? r.event) : "—"}</TableCell>
                <TableCell className="hidden md:table-cell">{r.ruleName ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRupees(r.amountPaise)}</TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <Badge variant={STATE[r.state].variant}>{STATE[r.state].label}</Badge>
                    {r.flags.length > 0 && r.state === "NEEDS_REVIEW" && <span className="max-w-48 text-xs text-muted-foreground">{r.flags.map(FLAG_TEXT).join(", ")}</span>}
                    {canAct && <LedgerButtons referrerId={r.referrerId} entryId={r.id} state={r.state} />}
                  </div>
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">{day(r.at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">Newest {rows.length} of {total}. The ledger is append-only: a reversal or approval is a new line, never an edit.</p>
    </div>
  );
}
