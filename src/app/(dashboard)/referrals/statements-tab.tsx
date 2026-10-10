import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "@/components/workspace";
import { formatRupees } from "@/lib/referrals/summary";
import type { ReadyRow, StatementView } from "@/lib/referrals/views";

import { PrepareStatement, StatementStep } from "./controls";

const monthName = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const STATUS = { PREPARED: { label: "Prepared, needs a second person", variant: "warning" }, APPROVED: { label: "Approved, to be paid outside the CRM", variant: "accent" }, PAID: { label: "Marked paid", variant: "success" } } as const;

export function StatementsTab({ period, ready, statements, canPrepare, canApprove }: { period: string; ready: ReadyRow[]; statements: StatementView[]; canPrepare: boolean; canApprove: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <Card size="sm" className={motion.enter}>
        <CardHeader>
          <CardTitle className="font-heading text-sm">Ready for {monthName(period)}</CardTitle>
        </CardHeader>
        <CardContent>
          {ready.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is waiting. Rewards in review are not included until someone clears them.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {ready.map((r) => (
                <li key={r.referrerId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    {r.referrerName} <span className="text-muted-foreground tabular-nums">{formatRupees(r.paise)} in {r.count} {r.count === 1 ? "reward" : "rewards"}</span>
                  </span>
                  {canPrepare && <PrepareStatement referrerId={r.referrerId} period={period} again={r.hasStatement} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <ul className="flex flex-col gap-3" aria-label="Statements">
        {statements.map((s, i) => (
          <li key={s.id}>
            <Card size="sm" className={motion.enter} style={{ ["--i" as string]: Math.min(i, 8) }}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {s.referrerName} <span className="font-normal text-muted-foreground">{monthName(s.period)}</span>
                  </p>
                  <p className="text-muted-foreground">
                    <span className="tabular-nums">{formatRupees(s.totalPaise)}</span> in {s.lineCount} {s.lineCount === 1 ? "reward" : "rewards"}. Prepared by {s.preparedBy}
                    {s.approvedBy ? `, approved by ${s.approvedBy}` : ""}
                    {s.bankReference ? `. Bank reference ${s.bankReference}` : ""}.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={STATUS[s.status].variant}>{STATUS[s.status].label}</Badge>
                  {canApprove && <StatementStep id={s.id} status={s.status} canApprove />}
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
        {statements.length === 0 && <li className="text-sm text-muted-foreground">No statements yet.</li>}
      </ul>
      <p className="text-xs text-muted-foreground">Someone other than the person who prepared a statement has to approve it. Marking it paid only records the bank reference of a payment finance made elsewhere: this system never moves money.</p>
    </div>
  );
}
