import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { motion } from "@/components/workspace";
import type { PartnerDetail } from "@/lib/partners/native/queries";
import type { buildPartnerListVM, partnerRowVM } from "@/lib/partners/native/view-models";
import { periodLabel as periodText } from "@/lib/partners/native/format";
import { empanelmentBadge, inr, payoutBadge, tierBadge } from "@/lib/partners/native/view-models";
import { CopyCodeButton } from "../copy-code-button";
import { FilterChips, Pager, SearchBox } from "../controls";
import { ToneBadge } from "../tone-badge";
import { EmptyForList } from "../views";
import { BackLink, BankBadge, enter, Note, Tile } from "./parts";

const rowStyle = (i: number) => ({ "--i": Math.min(i, 10) }) as React.CSSProperties;
const num = (n: number) => n.toLocaleString("en-IN");

export function NativeAffiliatesView({ vm, q, status, tier }: { vm: ReturnType<typeof buildPartnerListVM>; q?: string; status?: string; tier?: string }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterChips chips={vm.statusChips} label="Filter by empanelment status" />
          <SearchBox action="/partners/affiliates" q={q} placeholder="Search name or code" keep={{ status, tier }} />
        </div>
        <FilterChips chips={vm.tierChips} label="Filter by tier" />
      </div>
      <Card>
        <CardContent className="px-0">
          {vm.emptyReason ? (
            <EmptyForList reason={vm.emptyReason} noun="partners" firstHref={vm.firstHref} clearHref="/partners/affiliates" noneText="Partners appear here once they are empanelled." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Partner</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Empanelment</TableHead>
                    <TableHead>Bank</TableHead>
                    <TableHead className="text-right">Referred</TableHead>
                    <TableHead className="pr-4 text-right">Earned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vm.rows.map((r, i) => (
                    <TableRow key={r.id} className={motion.enter} style={rowStyle(i)}>
                      <TableCell className="pl-4">
                        <Link href={r.href} className="font-medium hover:underline">{r.name}</Link>
                        <p className="text-xs text-muted-foreground"><span className="font-mono">{r.code}</span> · {r.type}{r.parent ? <> · under <Link href={r.parent.href} className="hover:underline">{r.parent.name}</Link></> : null}</p>
                      </TableCell>
                      <TableCell><ToneBadge badge={r.tier} /></TableCell>
                      <TableCell><ToneBadge badge={r.status} /></TableCell>
                      <TableCell><BankBadge bank={r.bank} /></TableCell>
                      <TableCell className="text-right tabular-nums">{num(r.referred)}</TableCell>
                      <TableCell className="pr-4 text-right tabular-nums">{r.earned}</TableCell>
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

type Row = ReturnType<typeof partnerRowVM>;

/** One partner: who they are, how far they are from being paid, their sub-partners, recent payouts. */
export function NativePartnerDetailView({ row, detail, referred }: { row: Row; detail: PartnerDetail; referred: React.ReactNode }) {
  const t = detail.totals;
  return (
    <div className="flex flex-col gap-4">
      <BackLink href="/partners/affiliates">All partners</BackLink>
      <Card className={motion.enter}>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-xl font-extrabold tracking-tight">{row.name}</h2>
              <p className="text-sm text-muted-foreground">{row.type}{row.parent ? <> · under <Link href={row.parent.href} className="hover:underline">{row.parent.name}</Link></> : null}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ToneBadge badge={row.tier} />
              <ToneBadge badge={row.status} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Partner code</span>
            <CopyCodeButton code={row.code} />
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
            <div><dt className="text-xs text-muted-foreground">Empanelled</dt><dd className="font-medium">{row.empanelled}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Bank account</dt><dd className="font-medium"><BankBadge bank={row.bank} /></dd></div>
            <div><dt className="text-xs text-muted-foreground">Commission plan</dt><dd className="font-medium">{detail.plan ? detail.plan.name : "None assigned"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Referred people</dt><dd className="font-medium tabular-nums">{num(row.referred)}</dd></div>
          </dl>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Tile label="Earned to date" value={t.lifetime} format="inr" tone="success" index={1} />
        <Tile label="Accrued, not yet in a run" value={t.open} format="inr" index={2} hint="Estimate, moves into the next run" />
        <Tile label="Pending payout" value={t.pendingPayout} format="inr" tone="warning" index={3} hint="Estimated or approved" />
        <Tile label="Reconciled outside" value={t.paidOut} format="inr" index={4} hint="Confirmed by finance" />
      </div>

      {detail.subPartnerCount > 0 && (
        <Card className={motion.enter} style={enter(5)}>
          <CardHeader><CardTitle className="text-base">Sub-partners ({num(detail.subPartnerCount)})</CardTitle></CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead className="pl-4">Partner</TableHead><TableHead>Code</TableHead><TableHead>Tier</TableHead><TableHead className="pr-4">Empanelment</TableHead></TableRow></TableHeader>
                <TableBody>
                  {detail.subPartners.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="pl-4"><Link href={`/partners/affiliates/${encodeURIComponent(s.id)}`} className="font-medium hover:underline">{s.name}</Link></TableCell>
                      <TableCell className="font-mono text-xs">{s.code}</TableCell>
                      <TableCell><ToneBadge badge={tierBadge(s.tier)} /></TableCell>
                      <TableCell className="pr-4"><ToneBadge badge={empanelmentBadge(s.status)} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {detail.subPartnerCount > detail.subPartners.length && <p className="px-4 pt-2"><Note>Showing the first {detail.subPartners.length}. The Network tab has the full tree.</Note></p>}
          </CardContent>
        </Card>
      )}

      <Card className={motion.enter} style={enter(6)}>
        <CardHeader><CardTitle className="text-base">Recent payouts</CardTitle></CardHeader>
        <CardContent className="px-0">
          {detail.recentPayouts.length === 0 ? (
            <p className="px-4 text-sm text-muted-foreground">No payouts yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead className="pl-4">Period</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Net</TableHead><TableHead className="pr-4 text-right">Statement</TableHead></TableRow></TableHeader>
                <TableBody>
                  {detail.recentPayouts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="pl-4">{periodText(p.runStart, p.runEnd)}</TableCell>
                      <TableCell><ToneBadge badge={payoutBadge(p.status)} /></TableCell>
                      <TableCell className="text-right tabular-nums">{inr(p.net)}</TableCell>
                      <TableCell className="pr-4 text-right"><Link href={`/partners/statements/${encodeURIComponent(detail.row.id)}?run=${encodeURIComponent(p.runId)}`} className="font-medium underline-offset-4 hover:underline">Open</Link></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className={motion.enter} style={enter(7)}>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span>Referred clients and leads</span>
            <Link href={`/partners/referred-users?partner=${encodeURIComponent(row.id)}`} className="text-xs font-medium underline-offset-4 hover:underline">See all</Link>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">{referred}</CardContent>
      </Card>
    </div>
  );
}

