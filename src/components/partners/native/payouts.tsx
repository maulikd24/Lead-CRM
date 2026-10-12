import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShowFirstBlock, motion } from "@/components/workspace";
import type { buildPayoutsVM } from "@/lib/partners/native/view-models";
import { FilterChips, Pager } from "../controls";
import { ToneBadge } from "../tone-badge";
import { EmptyForList } from "../views";
import { BankBadge, Note } from "./parts";

type VM = ReturnType<typeof buildPayoutsVM>;
const rowStyle = (i: number) => ({ "--i": Math.min(i, 10) }) as React.CSSProperties;

function RunsTable({ rows }: { rows: NonNullable<VM["runs"]>["rows"] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Period</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Partners</TableHead>
            <TableHead className="text-right">Net payable</TableHead>
            <TableHead>Approved</TableHead>
            <TableHead className="pr-4 text-right">Payouts</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.id} className={motion.enter} style={rowStyle(i)}>
              <TableCell className="pl-4 font-medium">{r.period}</TableCell>
              <TableCell><ToneBadge badge={r.status} /></TableCell>
              <TableCell className="text-right tabular-nums">{r.payouts}</TableCell>
              <TableCell className="text-right tabular-nums">{r.total}</TableCell>
              <TableCell className="text-muted-foreground">{r.approved}</TableCell>
              <TableCell className="pr-4 text-right"><Link href={r.href} className="font-medium underline-offset-4 hover:underline">View payouts</Link></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    
  );
}

function PayoutsTable({ rows }: { rows: NonNullable<VM["payouts"]>["rows"] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Partner</TableHead>
            <TableHead>Period</TableHead>
            <TableHead>Payout</TableHead>
            <TableHead className="text-right">Net payable</TableHead>
            <TableHead className="pr-4">Empanelment and bank</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p, i) => (
            <TableRow key={p.id} className={motion.enter} style={rowStyle(i)}>
              <TableCell className="pl-4">
                <Link href={p.partnerHref} className="font-medium hover:underline">{p.partnerName}</Link>
                <p className="font-mono text-xs text-muted-foreground">{p.partnerCode}</p>
              </TableCell>
              <TableCell className="whitespace-nowrap">{p.period}</TableCell>
              <TableCell>
                <ToneBadge badge={p.status} />
                {p.externalRef && <p className="mt-1 font-mono text-xs text-muted-foreground">Ref {p.externalRef}</p>}
                {p.reconciled && <p className="text-xs text-muted-foreground">on {p.reconciled}</p>}
                <p className="mt-1 text-xs"><Link href={p.statementHref} className="font-medium underline underline-offset-4">Statement</Link></p>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <span className="font-medium">{p.net}</span>
                <p className="text-xs text-muted-foreground">{p.accrued} accrued{p.adjustment !== "₹0" ? `, ${p.adjustment} adjusted` : ""}</p>
              </TableCell>
              <TableCell className="pr-4">
                <div className="flex flex-col items-start gap-1">
                  <span className="inline-flex flex-wrap items-center gap-1.5"><ToneBadge badge={p.empanelment} /><BankBadge bank={p.bank} /></span>
                  {p.holds.length > 0 && (
                    <p className="flex items-start gap-1 text-xs text-warning"><ShieldAlert aria-hidden className="mt-0.5 size-3 shrink-0" />{p.holds.join(". ")}</p>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    
  );
}

export function NativePayoutsView({ vm }: { vm: VM }) {
  return (
    <div className="flex flex-col gap-4">
      <Note>Read-only. This system estimates and records payouts; it never moves money. A payout is &quot;Reconciled outside&quot; once the finance system confirms it was paid.</Note>
      <FilterChips chips={vm.viewChips} label="Payout runs or partner payouts" />
      {vm.runs && (
        <>
          {vm.runs.hiddenNote && <p role="note" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{vm.runs.hiddenNote}</p>}
          <Card>
            <CardContent className="px-0">
              {vm.runs.emptyReason ? (
                <EmptyForList reason={vm.runs.emptyReason} noun="payout runs" firstHref={vm.runs.firstHref} clearHref="/partners/payouts" noneText="Payout runs appear here once finance creates one." />
              ) : (
                <ShowFirstBlock name="runs" title="Payout runs" noun="runs" total={vm.runs.rows.length} preview={<RunsTable rows={vm.runs.rows.slice(0, 5)} />} full={<RunsTable rows={vm.runs.rows} />} />
              )}
            </CardContent>
          </Card>
          <Pager window={vm.runs.pagination} prevHref={vm.runs.prevHref} nextHref={vm.runs.nextHref} />
        </>
      )}
      {vm.payouts && (
        <>
          {vm.statusChips && <FilterChips chips={vm.statusChips} label="Filter by payout status" />}
          {vm.payouts.clearRunHref && (
            <p className="text-sm text-muted-foreground">Showing one payout run. <Link href={vm.payouts.clearRunHref} className="font-medium text-foreground underline underline-offset-4">Show every run</Link></p>
          )}
          <Card>
            <CardContent className="px-0">
              {vm.payouts.emptyReason ? (
                <EmptyForList reason={vm.payouts.emptyReason} noun="payouts" firstHref={vm.payouts.firstHref} clearHref="/partners/payouts?view=payouts" noneText="Partner payouts appear here once a payout run is built." />
              ) : (
                <ShowFirstBlock name="payouts" title="Partner payouts" noun="payouts" total={vm.payouts.rows.length} preview={<PayoutsTable rows={vm.payouts.rows.slice(0, 5)} />} full={<PayoutsTable rows={vm.payouts.rows} />} />
              )}
            </CardContent>
          </Card>
          <Note>{vm.payouts.holdNote}</Note>
          <Pager window={vm.payouts.pagination} prevHref={vm.payouts.prevHref} nextHref={vm.payouts.nextHref} />
        </>
      )}
    </div>
  );
}
