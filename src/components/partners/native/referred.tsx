import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { motion } from "@/components/workspace";
import type { buildReferredVM } from "@/lib/partners/native/view-models";
import { FilterChips, Pager, SearchBox } from "../controls";
import { ToneBadge } from "../tone-badge";
import { EmptyBlock } from "../states";
import { EmptyForList } from "../views";
import { Note } from "./parts";
import { PhoneFold } from "./phone-fold";

const rowStyle = (i: number) => ({ "--i": Math.min(i, 10) }) as React.CSSProperties;
type VM = ReturnType<typeof buildReferredVM>;

/** The rows alone, for the partner page, which shows the first few. */
export function ReferredTable({ rows, showPartner = true }: { rows: VM["rows"]; showPartner?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Person</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Stage</TableHead>
            {showPartner && <TableHead>Referred by</TableHead>}
            <TableHead>Source</TableHead>
            <TableHead className="pr-4">Since</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.id} className={motion.enter} style={rowStyle(i)}>
              <TableCell className="pl-4">
                <span className="font-medium">{r.name}</span>
                <p className="font-mono text-xs text-muted-foreground">{r.code}</p>
              </TableCell>
              <TableCell><ToneBadge badge={r.kind} /></TableCell>
              <TableCell><ToneBadge badge={r.stage} /></TableCell>
              {showPartner && (
                <TableCell>
                  <Link href={r.partnerHref} className="hover:underline">{r.partnerName}</Link>
                  <p className="font-mono text-xs text-muted-foreground">{r.partnerCode}</p>
                </TableCell>
              )}
              <TableCell className="text-muted-foreground">{r.source}</TableCell>
              <TableCell className="pr-4 text-muted-foreground">{r.since}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function NativeReferredView({ vm, q, segment, funnel, partner }: { vm: VM; q?: string; segment?: string; funnel?: string; partner?: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Note>Clients are people who opened an account through a partner (this is what commission is paid on). Leads are customer records tagged with a partner&apos;s code that have not opened one yet. Names are shortened; no phone, e-mail or PAN is shown here.</Note>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterChips chips={vm.segmentChips} label="Clients or leads" />
          <SearchBox action="/partners/referred-users" q={q} placeholder="Search customer or partner code" keep={{ segment: segment === "all" ? undefined : segment, funnel, partner }} />
        </div>
        <FilterChips chips={vm.funnelChips} label="Filter by stage" />
        {vm.partnerFilter && (
          <p className="text-sm text-muted-foreground">
            Showing one partner&apos;s people. <Link href={vm.partnerFilter.clearHref} className="font-medium text-foreground underline underline-offset-4">Show everyone</Link>
          </p>
        )}
      </div>
      {!(vm.rows.length === 0 && vm.hiddenNote) && (
      <Card>
        <CardContent className="px-0">
          {vm.emptyReason ? (
            <EmptyForList reason={vm.emptyReason} noun="referred people" firstHref={vm.firstHref} clearHref="/partners/referred-users" noneText="People who open an account through a partner, or arrive with a partner's code, appear here." />
          ) : (
            <PhoneFold count={vm.rows.length} title="Referred people"><ReferredTable rows={vm.rows} /></PhoneFold>
          )}
        </CardContent>
      </Card>
      )}
      {vm.hiddenNote && <p role="note" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{vm.hiddenNote}</p>}
      <Pager window={vm.pagination} prevHref={vm.prevHref} nextHref={vm.nextHref} />
    </div>
  );
}

export function EmptyReferred() {
  return <EmptyBlock title="No referred people yet" description="Nobody has opened an account through this partner." />;
}
