import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CountUp, motion } from "@/components/workspace";
import { cn } from "@/lib/utils";
import type { buildNativeOverviewVM } from "@/lib/partners/native/view-models";
import { CopyCodeButton } from "../copy-code-button";
import { PerformanceChart } from "../performance-chart";
import { EmptyBlock } from "../states";
import { enter, Note, TONE_TEXT, Tile } from "./parts";

type VM = ReturnType<typeof buildNativeOverviewVM>;
const rowStyle = (i: number) => ({ "--i": Math.min(i, 10) }) as React.CSSProperties;
const num = (n: number) => n.toLocaleString("en-IN");

// A lime ladder: the most senior tier is the strongest. Every segment is also labelled and counted, so colour is never the only cue.
const TIER_FILL = ["bg-primary", "bg-primary/70", "bg-primary/45", "bg-primary/25"];

function TierMix({ vm }: { vm: VM["tierMix"] }) {
  if (vm.total === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No partners yet.</p>;
  return (
    <div className="flex flex-col gap-4">
      <div role="img" aria-label={`Partners by tier: ${vm.segments.map((s) => `${s.label} ${s.count}`).join(", ")}`} className="h-3 overflow-hidden rounded-full bg-muted">
        <div className={cn(motion.growX, "flex h-full w-full gap-0.5")}>
          {vm.segments.map((s, i) => (
            <span key={s.tier} className={cn("h-full first:rounded-l-full last:rounded-r-full", TIER_FILL[i % TIER_FILL.length])} style={{ width: `${s.percent}%` }} />
          ))}
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {vm.segments.map((s, i) => (
          <li key={s.tier} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span aria-hidden className={cn("size-2.5 rounded-full", TIER_FILL[i % TIER_FILL.length])} />
              {s.label}
            </span>
            <span className="tabular-nums text-muted-foreground"><CountUp value={s.count} label={`${s.label} partners`} /> · {s.percent}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NativeOverviewView({ vm }: { vm: VM }) {
  if (vm.isEmpty) {
    return (
      <Card>
        <CardContent>
          <EmptyBlock title="No partners yet" description="Once partners are empanelled and their clients trade, their numbers appear here." />
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {vm.tiles.map((t, i) => (
          <Tile key={t.key} label={t.label} value={t.value} format={t.format} tone={t.tone} hint={t.hint} index={i} />
        ))}
      </div>
      <Card className={motion.enter} style={enter(4)}>
        <CardHeader><CardTitle className="text-base">Earnings by month</CardTitle></CardHeader>
        <CardContent><PerformanceChart chart={vm.chart} /></CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className={motion.enter} style={enter(5)}>
          <CardHeader><CardTitle className="text-base">Tier mix</CardTitle></CardHeader>
          <CardContent><TierMix vm={vm.tierMix} /></CardContent>
        </Card>
        <Card className={motion.enter} style={enter(6)}>
          <CardHeader><CardTitle className="text-base">Empanelment</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ul className="grid grid-cols-2 gap-3">
              {vm.statusMix.map((s) => (
                <li key={s.key} className="rounded-lg border border-border px-3 py-2">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className={cn("font-heading text-xl font-semibold", s.count > 0 && TONE_TEXT[s.tone])}><CountUp value={s.count} label={`${s.label} partners`} /></p>
                </li>
              ))}
            </ul>
            {vm.openRuns !== null && <Note>{vm.openRuns === 0 ? "No payout runs are open." : `${vm.openRuns} payout ${vm.openRuns === 1 ? "run is" : "runs are"} still open (draft, pending approval or approved).`}</Note>}
          </CardContent>
        </Card>
      </div>
      <Card className={motion.enter} style={enter(7)}>
        <CardHeader><CardTitle className="text-base">Top partners</CardTitle></CardHeader>
        <CardContent className="px-0">
          {vm.top.length === 0 ? (
            <EmptyBlock title="No ranking yet" description="Top partners show once commission has accrued." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 pl-4">#</TableHead>
                    <TableHead>Partner</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead className="text-right">Referred</TableHead>
                    <TableHead className="pr-4 text-right">Earned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vm.top.map((t, i) => (
                    <TableRow key={t.id} className={motion.enter} style={rowStyle(i)}>
                      <TableCell className="pl-4 text-muted-foreground">{t.rank}</TableCell>
                      <TableCell><Link href={t.href} className="font-medium hover:underline">{t.name}</Link></TableCell>
                      <TableCell><CopyCodeButton code={t.code} /></TableCell>
                      <TableCell className="text-right tabular-nums">{num(t.referees)}</TableCell>
                      <TableCell className="pr-4 text-right tabular-nums">{t.earnings}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
