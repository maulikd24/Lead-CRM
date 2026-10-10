import Link from "next/link";
import { Download, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { motion } from "@/components/workspace";
import { cn } from "@/lib/utils";
import type { buildOpenAccrualsVM, buildStatementIndexVM, buildStatementVM } from "@/lib/partners/native/view-models";
import { FilterChips, Pager } from "../controls";
import { ToneBadge } from "../tone-badge";
import { EmptyForList } from "../views";
import { BackLink, BankBadge, enter, Note, Tile } from "./parts";

const rowStyle = (i: number) => ({ "--i": Math.min(i, 10) }) as React.CSSProperties;

type IndexVM = ReturnType<typeof buildStatementIndexVM>;
type OpenVM = ReturnType<typeof buildOpenAccrualsVM>;
type StatementVM = ReturnType<typeof buildStatementVM>;

/** Plain anchors, not <Link>: opening one writes an audit entry, so it must never be prefetched. */
function ExportButtons({ csvHref, printHref, size = "sm" }: { csvHref: string; printHref: string; size?: "sm" | "default" }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size={size} variant="outline" render={<a href={csvHref} download />}><Download /> CSV</Button>
      <Button size={size} variant="outline" render={<a href={printHref} target="_blank" rel="noopener" />}><Printer /> Print</Button>
    </span>
  );
}

export function NativeStatementsView({ chips, index, open }: { chips: { key: string; label: string; active: boolean; href: string }[]; index?: IndexVM; open?: OpenVM }) {
  return (
    <div className="flex flex-col gap-4">
      <Note>One statement per partner per payout run: every accrual in it, any adjustment, and the net payable. Export it as CSV or open the print version (save it as PDF from your browser). Each export is recorded in the audit log.</Note>
      <FilterChips chips={chips} label="Statements by run or still open" />
      {index && (
        <>
          <Card>
            <CardContent className="px-0">
              {index.emptyReason ? (
                <EmptyForList reason={index.emptyReason} noun="statements" firstHref={index.firstHref} clearHref="/partners/statements" noneText="Statements appear here once a payout run is built." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Partner</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead>Payout</TableHead>
                        <TableHead className="text-right">Net payable</TableHead>
                        <TableHead className="pr-4 text-right">Statement</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {index.rows.map((r, i) => (
                        <TableRow key={r.id} className={motion.enter} style={rowStyle(i)}>
                          <TableCell className="pl-4"><span className="font-medium">{r.partnerName}</span><p className="font-mono text-xs text-muted-foreground">{r.partnerCode}</p></TableCell>
                          <TableCell>{r.period}<p className="text-xs"><ToneBadge badge={r.runStatus} /></p></TableCell>
                          <TableCell><ToneBadge badge={r.status} /></TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{r.net}</TableCell>
                          <TableCell className="pr-4">
                            <span className="flex flex-wrap items-center justify-end gap-2">
                              <Link href={r.href} className="text-sm font-medium underline-offset-4 hover:underline">View</Link>
                              <ExportButtons csvHref={r.csvHref} printHref={r.printHref} />
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
          <Pager window={index.pagination} prevHref={index.prevHref} nextHref={index.nextHref} />
        </>
      )}
      {open && (
        <>
          <Note>These partners have commission accrued that is not yet in a payout run. The figure is an estimate until a run is built.</Note>
          <Card>
            <CardContent className="px-0">
              {open.emptyReason ? (
                <EmptyForList reason={open.emptyReason} noun="open accruals" firstHref={open.firstHref} clearHref="/partners/statements?view=open" noneText="Every accrual is already in a payout run." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Partner</TableHead>
                        <TableHead className="text-right">Accruals</TableHead>
                        <TableHead className="text-right">Estimated</TableHead>
                        <TableHead className="pr-4 text-right">Statement</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {open.rows.map((r, i) => (
                        <TableRow key={r.partnerCode} className={motion.enter} style={rowStyle(i)}>
                          <TableCell className="pl-4"><span className="font-medium">{r.partnerName}</span><p className="font-mono text-xs text-muted-foreground">{r.partnerCode}</p></TableCell>
                          <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{r.amount}</TableCell>
                          <TableCell className="pr-4">
                            <span className="flex flex-wrap items-center justify-end gap-2">
                              <Link href={r.href} className="text-sm font-medium underline-offset-4 hover:underline">View</Link>
                              <Button size="sm" variant="outline" render={<a href={r.csvHref} download />}><Download /> CSV</Button>
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
          <Pager window={open.pagination} prevHref={open.prevHref} nextHref={open.nextHref} />
        </>
      )}
    </div>
  );
}

/** A statement on screen: summary tiles, one page of lines at a time, adjustments, the totals with the rounding line, and what is not computed. */
export function NativeStatementView({ vm, pageHref }: { vm: StatementVM; pageHref: (offset: number) => string }) {
  const t = vm.totals;
  return (
    <div className="flex flex-col gap-4">
      <BackLink href={vm.backHref}>All statements</BackLink>
      <Card className={motion.enter}>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-xl font-extrabold tracking-tight">{vm.partner.name}</h2>
              <p className="text-sm text-muted-foreground"><span className="font-mono">{vm.partner.code}</span> · {vm.partner.type}</p>
              <p className="mt-1 text-sm">{vm.periodLabel}</p>
            </div>
            <ExportButtons csvHref={vm.csvHref} printHref={vm.printHref} size="default" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {vm.isEstimate && <span role="note" className="rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">Estimate</span>}
            {vm.runStatus && <span className="flex items-center gap-1 text-xs text-muted-foreground">Run <ToneBadge badge={vm.runStatus} /></span>}
            {vm.payoutStatus && <span className="flex items-center gap-1 text-xs text-muted-foreground">Payout <ToneBadge badge={vm.payoutStatus} /></span>}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">Empanelment <ToneBadge badge={vm.empanelment} /></span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">Bank <BankBadge bank={vm.bank} /></span>
          </div>
          {vm.externalRef && <p className="text-sm text-muted-foreground">Finance reference <span className="font-mono">{vm.externalRef}</span>{vm.reconciled ? ` · reconciled ${vm.reconciled}` : ""}</p>}
        </CardContent>
      </Card>

      {!vm.check.matches && <p role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">{vm.check.message}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile label="Total accruals" value={t.grossValue} format="inr" index={1} hint={`${vm.lines.count} ${vm.lines.count === 1 ? "line" : "lines"}`} />
        <Tile label="Adjustments" value={t.adjustmentsValue} format="inr" tone={t.adjustmentsValue < 0 ? "destructive" : "default"} index={2} hint={`${vm.adjustments.length} ${vm.adjustments.length === 1 ? "entry" : "entries"}`} />
        <Tile label="Net payable" value={t.netValue} format="inr" tone={t.negativeNet ? "destructive" : "success"} index={3} hint={t.negativeNet ? "Negative: clawbacks exceed accruals" : undefined} />
      </div>

      <Card className={motion.enter} style={enter(4)}>
        <CardHeader><CardTitle className="text-base">Accruals</CardTitle></CardHeader>
        <CardContent className="px-0">
          {vm.lines.rows.length === 0 ? (
            <p className="px-4 text-sm text-muted-foreground">No accruals in this statement.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead className="pl-4">Date</TableHead><TableHead>Revenue</TableHead><TableHead>Customer</TableHead><TableHead className="pr-4 text-right">Amount</TableHead></TableRow></TableHeader>
                <TableBody>
                  {vm.lines.rows.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="pl-4 text-muted-foreground">{l.date}</TableCell>
                      <TableCell>{l.type}</TableCell>
                      <TableCell className="font-mono text-xs">{l.clientCode}</TableCell>
                      <TableCell className="pr-4 text-right tabular-nums">{l.amount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {vm.lines.count > vm.lines.rows.length || vm.lines.prevOffset !== null ? (
            <div className="flex items-center justify-between gap-3 px-4 pt-3 text-sm text-muted-foreground">
              <p aria-live="polite">{vm.lines.pagination.from}-{vm.lines.pagination.to} of {vm.lines.count.toLocaleString("en-IN")}</p>
              <div className="flex gap-2">
                {vm.lines.prevOffset !== null ? <Button size="sm" variant="outline" render={<Link href={pageHref(vm.lines.prevOffset)} />}>Previous</Button> : <Button size="sm" variant="outline" disabled>Previous</Button>}
                {vm.lines.nextOffset !== null ? <Button size="sm" variant="outline" render={<Link href={pageHref(vm.lines.nextOffset)} />}>Next</Button> : <Button size="sm" variant="outline" disabled>Next</Button>}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {vm.adjustments.length > 0 && (
        <Card className={motion.enter} style={enter(5)}>
          <CardHeader><CardTitle className="text-base">Adjustments</CardTitle></CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead className="pl-4">Date</TableHead><TableHead>Reason</TableHead><TableHead className="pr-4 text-right">Amount</TableHead></TableRow></TableHeader>
                <TableBody>
                  {vm.adjustments.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="pl-4 text-muted-foreground">{a.date}</TableCell>
                      <TableCell className="whitespace-normal">{a.reason}</TableCell>
                      <TableCell className={cn("pr-4 text-right tabular-nums", a.amount.startsWith("-") && "text-destructive")}>{a.amount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className={motion.enter} style={enter(6)}>
        <CardHeader><CardTitle className="text-base">Totals</CardTitle></CardHeader>
        <CardContent>
          <TotalsList totals={t} />
          <Assumptions items={vm.assumptions} />
        </CardContent>
      </Card>
    </div>
  );
}

export function TotalsList({ totals }: { totals: StatementVM["totals"] }) {
  return (
    <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
      <dt className="text-muted-foreground">Total accruals</dt><dd className="text-right tabular-nums">{totals.gross}</dd>
      <dt className="text-muted-foreground">Rounding</dt><dd className="text-right tabular-nums">{totals.rounding}</dd>
      <dt className="text-muted-foreground">Adjustments</dt><dd className="text-right tabular-nums">{totals.adjustments}</dd>
      <dt className="border-t border-border pt-1.5 font-semibold">Net payable</dt><dd className="border-t border-border pt-1.5 text-right font-semibold tabular-nums">{totals.net}</dd>
    </dl>
  );
}

export function Assumptions({ items }: { items: string[] }) {
  return (
    <ul className="mt-4 flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground">
      {items.map((a) => <li key={a}>{a}</li>)}
    </ul>
  );
}
