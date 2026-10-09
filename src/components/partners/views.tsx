import Link from "next/link";
import { ArrowLeft, Clock, IndianRupee, UserCheck, UserPlus, Users, Activity } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type {
  buildAffiliateListVM,
  buildOverviewVM,
  buildPayoutsVM,
  buildRefereesVM,
  buildReferrerDetailVM,
} from "@/lib/partners/view-models";
import { CopyCodeButton } from "./copy-code-button";
import { FilterChips, Pager, SearchBox } from "./controls";
import { KpiTile } from "./kpi-tile";
import { PerformanceChart } from "./performance-chart";
import { EmptyBlock } from "./states";
import { ToneBadge } from "./tone-badge";

const KPI_ICONS: Record<string, LucideIcon> = { affiliates: Users, pending: Clock, approved: UserCheck, referred: UserPlus, active: Activity, earnings: IndianRupee };
const num = (n: number) => n.toLocaleString("en-IN");
const rowStyle = (i: number) => ({ "--pw-i": Math.min(i, 10) }) as React.CSSProperties;

export function OverviewView({ vm }: { vm: ReturnType<typeof buildOverviewVM> }) {
  if (vm.isEmpty) {
    return (
      <Card>
        <CardContent>
          <EmptyBlock title="No affiliates yet" description="Once affiliates enrol and refer users, their numbers appear here." />
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {vm.kpis.map((k, i) => (
          <KpiTile key={k.key} kpi={k} icon={KPI_ICONS[k.key] ?? Users} index={i} pulse={k.key === "pending" && k.value > 0} />
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Affiliate performance</CardTitle></CardHeader>
        <CardContent><PerformanceChart chart={vm.chart} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Top affiliates</CardTitle></CardHeader>
        <CardContent className="px-0">
          {vm.top.length === 0 ? (
            <EmptyBlock title="No ranking yet" description="Top affiliates show once earnings are recorded." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4">#</TableHead>
                  <TableHead>Affiliate</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead className="text-right">Referred users</TableHead>
                  <TableHead className="pr-4 text-right">Earnings</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vm.top.map((t, i) => (
                  <TableRow key={t.id} className="pw-rise" style={rowStyle(i)}>
                    <TableCell className="pl-4 text-muted-foreground">{t.rank}</TableCell>
                    <TableCell><Link href={t.href} className="font-medium hover:underline">{t.name}</Link></TableCell>
                    <TableCell><CopyCodeButton code={t.code} /></TableCell>
                    <TableCell className="text-right tabular-nums">{num(t.referees)}</TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">{t.earnings}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function AffiliatesView({ vm, q }: { vm: ReturnType<typeof buildAffiliateListVM>; q?: string }) {
  const keepKyc = vm.chips.find((c) => c.active && c.key !== "all")?.key;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips chips={vm.chips} label="Filter by KYC status" />
        <SearchBox action="/partners/affiliates" q={q} placeholder="Search name or code" keep={{ kyc: keepKyc }} />
      </div>
      <Card>
        <CardContent className="px-0">
          {vm.emptyReason ? (
            <EmptyBlock
              title={vm.emptyReason === "filtered" ? "No affiliates match" : "No affiliates yet"}
              description={vm.emptyReason === "filtered" ? "Try a different search or clear the filters." : "Affiliates appear here once they enrol."}
              reset={vm.emptyReason === "filtered" ? { href: "/partners/affiliates", label: "Clear filters" } : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Affiliate</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>KYC</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Referred</TableHead>
                    <TableHead className="text-right">Earnings</TableHead>
                    <TableHead className="pr-4">Enrolled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vm.rows.map((r, i) => (
                    <TableRow key={r.id} className="pw-rise" style={rowStyle(i)}>
                      <TableCell className="pl-4">
                        <Link href={r.href} className="font-medium hover:underline">{r.name}</Link>
                        <p className="text-xs text-muted-foreground">{r.mobile}</p>
                      </TableCell>
                      <TableCell><CopyCodeButton code={r.code} /></TableCell>
                      <TableCell><ToneBadge badge={r.kyc} /></TableCell>
                      <TableCell><ToneBadge badge={r.status} /></TableCell>
                      <TableCell className="text-right tabular-nums">{num(r.referees)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.earnings}</TableCell>
                      <TableCell className="pr-4 text-muted-foreground">{r.enrolled}</TableCell>
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

export function RefereesTable({ rows, showReferrer = true }: { rows: ReturnType<typeof buildRefereesVM>["rows"]; showReferrer?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">User</TableHead>
            {showReferrer && <TableHead>Referred by</TableHead>}
            <TableHead>Stage</TableHead>
            <TableHead>KYC</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead className="pr-4">Signed up</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.id} className="pw-rise" style={rowStyle(i)}>
              <TableCell className="pl-4">
                <span className="font-medium">{r.name}</span>
                {r.clientCode !== "—" && <p className="text-xs text-muted-foreground">{r.clientCode}</p>}
              </TableCell>
              {showReferrer && (
                <TableCell>{r.referrerHref ? <Link href={r.referrerHref} className="hover:underline">{r.referrer}</Link> : r.referrer}</TableCell>
              )}
              <TableCell><ToneBadge badge={r.funnel} /></TableCell>
              <TableCell><ToneBadge badge={r.kyc} /></TableCell>
              <TableCell className="text-muted-foreground">{r.channel}</TableCell>
              <TableCell className="pr-4 text-muted-foreground">{r.signedUp}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function RefereesView({ vm, q }: { vm: ReturnType<typeof buildRefereesVM>; q?: string }) {
  const keepFunnel = vm.funnelChips.find((c) => c.active && c.key !== "all")?.key;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips chips={vm.funnelChips} label="Filter by stage" />
        <SearchBox action="/partners/referred-users" q={q} placeholder="Search by affiliate name" keep={{ funnel: keepFunnel }} />
      </div>
      <Card>
        <CardContent className="px-0">
          {vm.emptyReason ? (
            <EmptyBlock
              title={vm.emptyReason === "filtered" ? "No referred users match" : "No referred users yet"}
              description={vm.emptyReason === "filtered" ? "Try a different search or clear the filters." : "People who sign up with an affiliate's code appear here."}
              reset={vm.emptyReason === "filtered" ? { href: "/partners/referred-users", label: "Clear filters" } : undefined}
            />
          ) : (
            <RefereesTable rows={vm.rows} />
          )}
        </CardContent>
      </Card>
      <Pager window={vm.pagination} prevHref={vm.prevHref} nextHref={vm.nextHref} />
    </div>
  );
}

export function AffiliateDetailView({ vm }: { vm: ReturnType<typeof buildReferrerDetailVM> }) {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/partners/affiliates" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> All affiliates
      </Link>
      <Card className="pw-rise">
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-xl font-extrabold tracking-tight">{vm.name}</h2>
              <p className="text-sm text-muted-foreground">{vm.mobile}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ToneBadge badge={vm.status} />
              <ToneBadge badge={vm.kyc} />
            </div>
          </div>
          {vm.statusNote && <p className="text-sm text-destructive">{vm.statusNote}</p>}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Referral code</span>
            <CopyCodeButton code={vm.code} />
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
            {vm.facts.map((f) => (
              <div key={f.label}>
                <dt className="text-xs text-muted-foreground">{f.label}</dt>
                <dd className="font-medium">{f.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="pw-rise lg:col-span-2" style={{ "--pw-i": 1 } as React.CSSProperties}>
          <CardHeader><CardTitle className="text-base">Earnings and payouts</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="font-heading text-3xl font-semibold tracking-tight">{vm.earningsTotal}<span className="ml-2 text-sm font-normal text-muted-foreground">lifetime earnings</span></p>
            <div className="grid grid-cols-3 gap-3">
              {vm.money.map((m) => (
                <div key={m.label} className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{m.label}</p>
                  <p className="font-heading text-lg font-semibold tabular-nums">{m.value}</p>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">Payouts: {vm.payoutLine}. Last paid {vm.lastPaid}.</p>
          </CardContent>
        </Card>
        <Card className="pw-rise" style={{ "--pw-i": 2 } as React.CSSProperties}>
          <CardHeader><CardTitle className="text-base">Activity</CardTitle></CardHeader>
          <CardContent>
            {vm.activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity recorded.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {vm.activity.map((a, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                    <span><span className="block">{a.label}</span><span className="text-xs text-muted-foreground">{a.at}</span></span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Referred users ({num(vm.referees.total)})</CardTitle></CardHeader>
        <CardContent className="px-0">
          {vm.referees.rows.length === 0 ? (
            <EmptyBlock title="No referred users yet" description="Nobody has signed up with this affiliate's code." />
          ) : (
            <RefereesTable rows={vm.referees.rows} showReferrer={false} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function PayoutsView({ vm }: { vm: ReturnType<typeof buildPayoutsVM> }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Read-only. Approvals and payments are made in the referral system.</p>
      {vm.totals.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {vm.totals.map((t, i) => (
            <Card key={t.key} size="sm" className="pw-rise" style={{ "--pw-i": i } as React.CSSProperties}>
              <CardContent className="flex flex-col gap-1 px-4">
                <ToneBadge badge={t.badge} />
                <p className="font-heading text-xl font-semibold tabular-nums">{t.amount}</p>
                <p className="text-xs text-muted-foreground">{num(t.count)} {t.count === 1 ? "request" : "requests"}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <FilterChips chips={vm.chips} label="Filter by payout status" />
      <Card>
        <CardContent className="px-0">
          {vm.emptyReason ? (
            <EmptyBlock
              title={vm.emptyReason === "filtered" ? "No payouts with that status" : "No payout requests yet"}
              description={vm.emptyReason === "filtered" ? "Pick another status." : "Withdrawal requests from affiliates appear here."}
              reset={vm.emptyReason === "filtered" ? { href: "/partners/payouts", label: "Show all" } : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Reference</TableHead>
                    <TableHead>Affiliate</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">TDS</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead className="pr-4">Paid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vm.rows.map((r, i) => (
                    <TableRow key={r.id} className="pw-rise" style={rowStyle(i)}>
                      <TableCell className="pl-4 font-mono text-xs">{r.ref}</TableCell>
                      <TableCell>{r.referrerHref ? <Link href={r.referrerHref} className="hover:underline">{r.referrer}</Link> : r.referrer}</TableCell>
                      <TableCell><ToneBadge badge={r.status} /></TableCell>
                      <TableCell className="text-right tabular-nums">{r.amount}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{r.tds}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.net}</TableCell>
                      <TableCell className="text-muted-foreground">{r.requested}</TableCell>
                      <TableCell className="pr-4 text-muted-foreground">{r.paid}</TableCell>
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
