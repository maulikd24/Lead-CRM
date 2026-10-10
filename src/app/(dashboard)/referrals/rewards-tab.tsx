import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EVENT_LABEL, type ReferralEventType } from "@/lib/referrals/state-machine";
import { formatRupees } from "@/lib/referrals/summary";
import { FLAG_TEXT, type AccrualState, type LedgerRow } from "@/lib/referrals/views";

import { LedgerButtons } from "./controls";

const STATE: Record<AccrualState, { label: string; variant: "success" | "warning" | "outline" | "accent" | "destructive" }> = {
  NEEDS_REVIEW: { label: "Needs review", variant: "warning" },
  ACCRUED: { label: "Accrued", variant: "accent" },
  APPROVED: { label: "Approved", variant: "success" },
  PAID: { label: "Marked paid", variant: "success" },
  REVERSED: { label: "Reversed", variant: "outline" },
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
              <TableHead>Referred customer</TableHead>
              <TableHead>Step</TableHead>
              <TableHead>Rule</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Date</TableHead>
              {canAct && <TableHead><span className="sr-only">Actions</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.referrerName}</TableCell>
                <TableCell className="tabular-nums">{r.referredCode ?? "Removed"}</TableCell>
                <TableCell>{r.event ? (EVENT_LABEL[r.event as ReferralEventType] ?? r.event) : "—"}</TableCell>
                <TableCell>{r.ruleName ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRupees(r.amountPaise)}</TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <Badge variant={STATE[r.state].variant}>{STATE[r.state].label}</Badge>
                    {r.flags.length > 0 && r.state === "NEEDS_REVIEW" && <span className="max-w-48 text-xs text-muted-foreground">{r.flags.map(FLAG_TEXT).join(", ")}</span>}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{day(r.at)}</TableCell>
                {canAct && (
                  <TableCell>
                    <LedgerButtons referrerId={r.referrerId} entryId={r.id} state={r.state} />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">Newest {rows.length} of {total}. The ledger is append-only: a reversal or approval is a new line, never an edit.</p>
    </div>
  );
}
