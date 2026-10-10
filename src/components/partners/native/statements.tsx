import Link from "next/link";
import { Download, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { motion } from "@/components/workspace";
import { cn } from "@/lib/utils";
import type { buildOpenAccrualsVM, buildPeriodIndexVM, buildStatementIndexVM, buildStatementVM } from "@/lib/partners/native/view-models";
import { FilterChips, Pager } from "../controls";
import { ToneBadge } from "../tone-badge";
import { EmptyForList } from "../views";
import { BackLink, BankBadge, enter, Note, Tile } from "./parts";
import { PhoneFold } from "./phone-fold";
import { RaiseQuery } from "./raise-query";

const rowStyle = (i: number) => ({ "--i": Math.min(i, 10) }) as React.CSSProperties;

type IndexVM = ReturnType<typeof buildStatementIndexVM>;
type OpenVM = ReturnType<typeof buildOpenAccrualsVM>;
type PeriodVM = ReturnType<typeof buildPeriodIndexVM>;
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

export function NativeStatementsView({ chips, index, open, period }: { chips: { key: string; label: string; active: boolean; href: string }[]; index?: IndexVM; open?: OpenVM; period?: PeriodVM }) {
  return (
    <div className="flex flex-col gap-4">
      <Note>A statement lists every accrual in its period, any adjustment, and what is payable after the tax rules Finance configured. Choose a payout run, a calendar month or a financial year (April to March); export it as CSV or open the print version. Each export is recorded in the audit log.</Note>
      <FilterChips chips={chips} label="Statements by run, month, financial year or still open" />
      {period && <PeriodIndex vm={period} />}
      {index && (
        <>
          <Card>
            <CardContent className="px-0">
              {index.emptyReason ? (
                <EmptyForList reason={index.emptyReason} noun="statements" firstHref={index.firstHref} clearHref="/partners/statements" noneText="Statements appear here once a payout run is built." />
              ) : (
                <PhoneFold count={index.rows.length} title="Statements">
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
                </PhoneFold>
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

function PeriodIndex({ vm }: { vm: PeriodVM }) {
  return (
    <>
      <nav aria-label={vm.kind === "month" ? "Choose a month" : "Choose a financial year"} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {vm.choices.map((c) => (
          <Link key={c.key} href={c.href} aria-current={c.active ? "true" : undefined} className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none", c.active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground")}>{c.label}</Link>
        ))}
      </nav>
      <p className="text-sm font-medium">{vm.title}</p>
      <Card>
        <CardContent className="px-0">
          {!vm.valid || vm.emptyReason ? (
            <EmptyForList reason={vm.emptyReason ?? "none"} noun="statements" firstHref={vm.firstHref} clearHref={`/partners/statements?view=${vm.kind}`} noneText="No partner has commission accrued in this period." />
          ) : (
            <PhoneFold count={vm.rows.length} title={vm.title}>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Partner</TableHead>
                      <TableHead className="text-right">Accruals</TableHead>
                      <TableHead className="text-right">Earned</TableHead>
                      <TableHead className="pr-4 text-right">Statement</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vm.rows.map((r, i) => (
                      <TableRow key={r.id} className={motion.enter} style={rowStyle(i)}>
                        <TableCell className="pl-4"><span className="font-medium">{r.partnerName}</span><p className="font-mono text-xs text-muted-foreground">{r.partnerCode}{r.totalsOnly && <span className="font-sans"> · totals only</span>}</p></TableCell>
                        <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{r.total}</TableCell>
                        <TableCell className="pr-4">
                          <span className="flex flex-wrap items-center justify-end gap-2">
                            <Link href={r.href} className="text-sm font-medium underline-offset-4 hover:underline">View</Link>
                            {r.cumulativeHref && <Link href={r.cumulativeHref} className="text-sm font-medium underline-offset-4 hover:underline">Year to date</Link>}
                            <ExportButtons csvHref={r.csvHref} printHref={r.printHref} />
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </PhoneFold>
          )}
        </CardContent>
      </Card>
      <Pager window={vm.pagination} prevHref={vm.prevHref} nextHref={vm.nextHref} />
    </>
  );
}

/** A statement on screen: summary tiles, one page of lines at a time, adjustments, tax with the exact rule used, totals, and what is not computed. */
export function NativeStatementView({ vm, pageHref }: { vm: StatementVM; pageHref: (offset: number) => string }) {
  const t = vm.totals;
  const hasTaxLines = (vm.tax?.lines.length ?? 0) > 0;
  return (
    <div className="flex flex-col gap-4">
      <BackLink href={vm.backHref}>All statements</BackLink>
      <Card className={motion.enter}>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{vm.kindLabel}</p>
              <h2 className="font-heading text-xl font-extrabold tracking-tight">{vm.partner.name}</h2>
              <p className="text-sm text-muted-foreground"><span className="font-mono">{vm.partner.code}</span> · {vm.partner.type}</p>
              <p className="mt-1 text-sm">{vm.periodLabel}</p>
            </div>
            <span className="max-sm:hidden"><ExportButtons csvHref={vm.csvHref} printHref={vm.printHref} size="default" /></span>
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

      {vm.detailNote && <p role="note" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{vm.detailNote}</p>}
      {!vm.check.matches && <p role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">{vm.check.message}</p>}

      {vm.cumulative ? (
        <CumulativeSection vm={vm} />
      ) : (
        <>
          <div className={cn("grid grid-cols-2 gap-3", hasTaxLines ? "lg:grid-cols-4" : "sm:grid-cols-3")}>
            <Tile label="Total accruals" value={t.grossValue} format="inr" index={1} hint={vm.detailHidden ? "Totals only" : `${vm.lines.count} ${vm.lines.count === 1 ? "line" : "lines"}`} />
            <Tile label="Adjustments" value={t.adjustmentsValue} format="inr" tone={t.adjustmentsValue < 0 ? "destructive" : "default"} index={2} hint={vm.detailHidden ? undefined : `${vm.adjustments.length} ${vm.adjustments.length === 1 ? "entry" : "entries"}`} />
            <Tile label={hasTaxLines ? "Net before tax" : "Net payable"} value={t.netValue} format="inr" tone={t.negativeNet ? "destructive" : hasTaxLines ? "default" : "success"} index={3} hint={t.negativeNet ? "Negative: clawbacks exceed accruals" : undefined} />
            {hasTaxLines && <Tile label="Payable after tax" value={t.payableValue} format="inr" tone={t.negativePayable ? "destructive" : "success"} index={4} />}
          </div>

          {!vm.detailHidden && (
            <Card className={motion.enter} style={enter(5)}>
              <CardHeader><CardTitle className="text-base">Accruals</CardTitle></CardHeader>
              <CardContent className="px-0">
                {vm.lines.rows.length === 0 ? (
                  <p className="px-4 text-sm text-muted-foreground">No accruals in this statement.</p>
                ) : (
                  <PhoneFold count={vm.lines.rows.length} title="Accruals">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader><TableRow><TableHead className="pl-4">Date</TableHead><TableHead>Revenue</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Amount</TableHead>{vm.canQuery && <TableHead className="pr-4"><span className="sr-only">Query</span></TableHead>}</TableRow></TableHeader>
                        <TableBody>
                          {vm.lines.rows.map((l) => (
                            <TableRow key={l.id}>
                              <TableCell className="pl-4 text-muted-foreground">{l.date}</TableCell>
                              <TableCell>{l.type}</TableCell>
                              <TableCell className="font-mono text-xs">{l.clientCode}</TableCell>
                              <TableCell className={cn("text-right tabular-nums", !vm.canQuery && "pr-4")}>{l.amount}</TableCell>
                              {vm.canQuery && <TableCell className="pr-4 text-right"><RaiseQuery partnerId={vm.partner.id} period={vm.periodKey} lineRef={l.queryRef} label={`the ${l.type.toLowerCase()} line of ${l.date}`} /></TableCell>}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </PhoneFold>
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
          )}

          {vm.adjustments.length > 0 && (
            <Card className={motion.enter} style={enter(6)}>
              <CardHeader><CardTitle className="text-base">Adjustments</CardTitle></CardHeader>
              <CardContent className="px-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead className="pl-4">Date</TableHead><TableHead>Reason</TableHead><TableHead className="text-right">Amount</TableHead>{vm.canQuery && <TableHead className="pr-4"><span className="sr-only">Query</span></TableHead>}</TableRow></TableHeader>
                    <TableBody>
                      {vm.adjustments.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="pl-4 text-muted-foreground">{a.date}</TableCell>
                          <TableCell className="whitespace-normal">{a.reason}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", a.amount.startsWith("-") && "text-destructive", !vm.canQuery && "pr-4")}>{a.amount}</TableCell>
                          {vm.canQuery && <TableCell className="pr-4 text-right"><RaiseQuery partnerId={vm.partner.id} period={vm.periodKey} lineRef={a.queryRef} label={`the adjustment of ${a.date}`} /></TableCell>}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {(vm.tax || vm.taxNote) && <TaxSection vm={vm} />}

          <Card className={motion.enter} style={enter(8)}>
            <CardHeader><CardTitle className="text-base">Totals</CardTitle></CardHeader>
            <CardContent>
              <TotalsList totals={t} taxLines={vm.tax?.lines ?? []} />
              <Assumptions items={vm.assumptions} />
            </CardContent>
          </Card>
        </>
      )}

      {/* Phone density: the actions stay in reach, at the bottom of the section. */}
      <div className="sticky bottom-0 z-10 -mx-1 border-t border-border bg-background/95 px-1 py-2 backdrop-blur sm:hidden">
        <ExportButtons csvHref={vm.csvHref} printHref={vm.printHref} size="default" />
      </div>
    </div>
  );
}

/** Each tax line with the exact rule used, the rounding rule and the Finance note, or a clear statement of why there is none. */
export function TaxSection({ vm, print = false }: { vm: Pick<StatementVM, "tax" | "taxNote">; print?: boolean }) {
  const tax = vm.tax;
  return (
    <Card className={print ? undefined : motion.enter} style={print ? undefined : enter(7)}>
      <CardHeader><CardTitle className="text-base">Tax</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        {vm.taxNote && <p className="text-sm text-muted-foreground">{vm.taxNote}</p>}
        {tax?.message && <p role="note" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">{tax.message}</p>}
        {tax && tax.lines.length > 0 && (
          <ul className="flex flex-col gap-3">
            {tax.lines.map((l) => (
              <li key={l.label + l.kindLabel} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold">{l.kindLabel}: {l.label} <span className="font-normal text-muted-foreground">at {l.rate}</span></p>
                  <p className={cn("font-heading text-base font-semibold tabular-nums", l.effect.startsWith("-") && "text-destructive")}>{l.memo ? `${l.amount} (shown, not deducted)` : l.effect}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">On {l.base}{l.running ? ` this statement, ${l.running} for the financial year to date` : ""}. {l.kindLabel === "TDS" && !l.thresholdPassed ? "The financial year's total has not passed the threshold, so nothing is deducted yet. " : ""}</p>
                <p className="mt-1 text-xs"><span className="font-medium">Rule used:</span> <span className="text-muted-foreground">{l.ruleText}</span></p>
              </li>
            ))}
          </ul>
        )}
        {tax?.missingNote && <p className="text-xs text-muted-foreground">{tax.missingNote}</p>}
        {tax && <p className="text-xs text-muted-foreground">{tax.rounding}</p>}
        {tax && <p className="text-xs font-medium">{tax.note}</p>}
      </CardContent>
    </Card>
  );
}

/** The financial year to date, month by month, with the tax carried each month: what a tax return needs. */
export function CumulativeSection({ vm }: { vm: StatementVM }) {
  const c = vm.cumulative!;
  return (
    <Card className={motion.enter} style={enter(2)}>
      <CardHeader><CardTitle className="text-base">Month by month</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        {c.message && <p role="note" className="mx-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">{c.message}</p>}
        <PhoneFold count={c.rows.length} title="Month by month">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead className="pl-4">Month</TableHead><TableHead className="text-right">Earned</TableHead><TableHead className="text-right">Adjustments</TableHead><TableHead className="text-right">Running total</TableHead><TableHead className="text-right">TDS</TableHead><TableHead className="pr-4 text-right">GST</TableHead></TableRow></TableHeader>
              <TableBody>
                {c.rows.map((r) => (
                  <TableRow key={r.monthLabel}>
                    <TableCell className="pl-4">{r.monthLabel}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.accruals}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.adjustments}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.running}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.tds}</TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">{r.gst}{r.gstMemo ? " (memo)" : ""}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold"><TableCell className="pl-4">Year to date</TableCell><TableCell className="text-right tabular-nums" colSpan={2}>{c.totals.base}</TableCell><TableCell /><TableCell className="text-right tabular-nums">{c.totals.tds}</TableCell><TableCell className="pr-4 text-right tabular-nums">{c.totals.gst}</TableCell></TableRow>
              </TableBody>
            </Table>
          </div>
        </PhoneFold>
        <p className="px-4 text-xs text-muted-foreground">{c.rounding}</p>
        <p className="px-4 text-xs font-medium">{c.note}</p>
      </CardContent>
    </Card>
  );
}

export function TotalsList({ totals, taxLines = [] }: { totals: StatementVM["totals"]; taxLines?: NonNullable<StatementVM["tax"]>["lines"] }) {
  const hasTax = taxLines.length > 0;
  return (
    <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
      <dt className="text-muted-foreground">Total accruals</dt><dd className="text-right tabular-nums">{totals.gross}</dd>
      <dt className="text-muted-foreground">Rounding</dt><dd className="text-right tabular-nums">{totals.rounding}</dd>
      <dt className="text-muted-foreground">Adjustments</dt><dd className="text-right tabular-nums">{totals.adjustments}</dd>
      <dt className={cn("pt-1.5", hasTax ? "text-muted-foreground" : "border-t border-border font-semibold")}>{hasTax ? "Net before tax" : "Net payable"}</dt><dd className={cn("pt-1.5 text-right tabular-nums", hasTax ? "" : "border-t border-border font-semibold")}>{totals.net}</dd>
      {taxLines.map((l) => (
        <div key={l.label + l.kindLabel} className="col-span-2 grid grid-cols-subgrid">
          <dt className="text-muted-foreground">{l.kindLabel} ({l.rate}){l.memo ? ", not deducted" : ""}</dt><dd className="text-right tabular-nums">{l.memo ? l.amount : l.effect}</dd>
        </div>
      ))}
      {hasTax && <><dt className="border-t border-border pt-1.5 font-semibold">Payable</dt><dd className="border-t border-border pt-1.5 text-right font-semibold tabular-nums">{totals.payable}</dd></>}
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
