import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { motion } from "@/components/workspace";
import type { buildNetworkVM } from "@/lib/partners/native/view-models";
import { Pager } from "../controls";
import { ToneBadge } from "../tone-badge";
import { EmptyForList } from "../views";
import { Note } from "./parts";

const rowStyle = (i: number) => ({ "--i": Math.min(i, 10) }) as React.CSSProperties;

/** The commercial roll-up as an indented list: each partner under the one they roll up to, with their own earnings and the total of their branch. */
export function NativeNetworkView({ vm }: { vm: ReturnType<typeof buildNetworkVM> }) {
  return (
    <div className="flex flex-col gap-4">
      <Note>Partners sit under the partner they roll up to. &quot;Own&quot; is commission accrued on that partner&apos;s own clients; &quot;Branch&quot; adds everyone below. The branch figure is a roll-up for reading: commission is paid to the partner whose client generated the revenue.</Note>
      {vm.capped && <p role="note" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">The network is very large, so only the first 5,000 partners are drawn.</p>}
      <Card>
        <CardContent className="px-0">
          {vm.emptyReason ? (
            <EmptyForList reason={vm.emptyReason} noun="partners" firstHref={vm.firstHref} clearHref="/partners/network" noneText="Partners appear here once they are empanelled." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Partner</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Empanelment</TableHead>
                    <TableHead className="text-right">Referred</TableHead>
                    <TableHead className="text-right">Own</TableHead>
                    <TableHead className="pr-4 text-right">Branch</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vm.rows.map((r, i) => (
                    <TableRow key={r.id} className={motion.enter} style={rowStyle(i)}>
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-2" style={{ paddingLeft: r.indent }}>
                          {r.depth > 0 && <span aria-hidden className="h-3 w-3 shrink-0 rounded-bl-md border-b border-l border-border" />}
                          <div>
                            <Link href={r.href} className="font-medium hover:underline">{r.name}</Link>
                            <p className="font-mono text-xs text-muted-foreground">
                              {r.code}
                              {r.hasChildren && <span className="font-sans"> · {r.childCount} direct</span>}
                              {r.truncated && <span className="font-sans"> · more below, not drawn</span>}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell><ToneBadge badge={r.tier} /></TableCell>
                      <TableCell><ToneBadge badge={r.status} /></TableCell>
                      <TableCell className="text-right tabular-nums">{r.referred.toLocaleString("en-IN")}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.own}</TableCell>
                      <TableCell className="pr-4 text-right font-medium tabular-nums">{r.rollup}</TableCell>
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
