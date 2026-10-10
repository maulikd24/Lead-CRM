import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { motion } from "@/components/workspace";
import { cn } from "@/lib/utils";
import type { Explanation } from "@/lib/partners/native/explain";
import type { buildAdjustmentsVM, buildCommissionsVM } from "@/lib/partners/native/view-models";
import { FilterChips, Pager, SearchBox } from "../controls";
import { ToneBadge } from "../tone-badge";
import { EmptyForList } from "../views";
import { Note } from "./parts";

type CVM = ReturnType<typeof buildCommissionsVM>;
type AVM = ReturnType<typeof buildAdjustmentsVM>;

/** How one accrual was computed: the rule that applied, the slab if there was one, and whether the stored amount still agrees. Plain `<details>`: works without scripts. */
function Working({ e }: { e: Explanation }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="font-medium">{e.headline}</p>
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-muted-foreground">
        {e.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      {e.slabs && (
        <table className="w-full max-w-sm text-xs">
          <caption className="sr-only">Slabs of this rule, the one that applied is marked</caption>
          <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3 font-medium">Slab</th><th className="py-1 pr-3 text-right font-medium">Rate</th><th className="py-1 font-medium">Applied</th></tr></thead>
          <tbody>
            {e.slabs.map((s) => (
              <tr key={s.label} className={cn(s.applied && "font-semibold text-foreground")}>
                <td className="py-0.5 pr-3">{s.label}</td>
                <td className="py-0.5 pr-3 text-right tabular-nums">{s.rate}%</td>
                <td className="py-0.5">{s.applied ? "Yes" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {e.note && <p role="note" className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">{e.note}</p>}
    </div>
  );
}

export function NativeCommissionsView({ vm, q, accrual, partner }: { vm: CVM; q?: string; accrual?: string; partner?: string }) {
  return (
    <div className="flex flex-col gap-4">
      <FilterChips chips={vm.viewChips} label="Accruals or adjustments" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips chips={vm.statusChips} label="Filter by accrual status" />
        <SearchBox action="/partners/commissions" q={q} placeholder="Search customer or partner code" keep={{ accrual, partner }} />
      </div>
      <Note>Amounts are worked out by the earnings engine from the rule on each partner&apos;s plan. Open &quot;How was this worked out?&quot; on any row to see the rule, the slab and the sums. No tax is calculated here.</Note>
      <Card>
        <CardContent className="px-0">
          {vm.emptyReason ? (
            <EmptyForList reason={vm.emptyReason} noun="accruals" firstHref={vm.firstHref} clearHref="/partners/commissions" noneText="Commission accruals appear here once revenue is booked against a partner's client." />
          ) : (
            <ul className="divide-y divide-border">
              {vm.rows.map((r, i) => (
                <li key={r.id} className={motion.enter} style={{ "--i": Math.min(i, 10) } as React.CSSProperties}>
                  <details className="group px-4 py-3">
                    <summary className="grid cursor-pointer list-none [&::-webkit-details-marker]:hidden grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:grid-cols-[7rem_1.4fr_1fr_1fr_1fr_auto]">
                      <span className="text-sm text-muted-foreground">{r.date}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{r.partnerName}</span>
                        <span className="font-mono text-xs text-muted-foreground">{r.partnerCode}</span>
                      </span>
                      <span className="hidden text-sm sm:block"><span className="block">{r.type}</span><span className="font-mono text-xs text-muted-foreground">{r.clientCode}</span></span>
                      <span className="hidden text-right text-sm tabular-nums text-muted-foreground sm:block">{r.gross}<span className="block text-xs">gross</span></span>
                      <span className="text-right font-heading text-base font-semibold tabular-nums sm:text-left">{r.amount}</span>
                      <span className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:justify-end">
                        <ToneBadge badge={r.status} />
                        <span className="text-xs font-medium text-muted-foreground underline underline-offset-4 group-open:text-foreground">How was this worked out?</span>
                      </span>
                    </summary>
                    <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
                      <p className="mb-2 text-xs text-muted-foreground sm:hidden">{r.type}, customer {r.clientCode}, gross {r.gross}</p>
                      <Working e={r.explanation} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Pager window={vm.pagination} prevHref={vm.prevHref} nextHref={vm.nextHref} />
    </div>
  );
}

export function NativeAdjustmentsView({ vm }: { vm: AVM }) {
  return (
    <div className="flex flex-col gap-4">
      <FilterChips chips={vm.viewChips} label="Accruals or adjustments" />
      <Note>Adjustments are manual corrections (for example a clawback). Each is approved by a second person before it is applied, and sits against one payout.</Note>
      <Card>
        <CardContent className="px-0">
          {vm.emptyReason ? (
            <EmptyForList reason={vm.emptyReason} noun="adjustments" firstHref={vm.firstHref} clearHref="/partners/commissions?view=adjustments" noneText="Manual corrections to a payout appear here." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Date</TableHead>
                    <TableHead>Partner</TableHead>
                    <TableHead>Payout period</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="pr-4 text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vm.rows.map((a, i) => (
                    <TableRow key={a.id} className={motion.enter} style={{ "--i": Math.min(i, 10) } as React.CSSProperties}>
                      <TableCell className="pl-4 text-muted-foreground">{a.date}</TableCell>
                      <TableCell><Link href={a.partnerHref} className="font-medium hover:underline">{a.partnerName}</Link><p className="font-mono text-xs text-muted-foreground">{a.partnerCode}</p></TableCell>
                      <TableCell className="text-muted-foreground">{a.period}</TableCell>
                      <TableCell className="max-w-xs whitespace-normal">{a.reason}{a.approved && <span className="block text-xs text-muted-foreground">Approved by a second person</span>}</TableCell>
                      <TableCell className={cn("pr-4 text-right tabular-nums", a.negative && "text-destructive")}>{a.amount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <Pager window={vm.pagination} prevHref={vm.prevHref} nextHref={vm.nextHref} />
    </div>
  );
}
