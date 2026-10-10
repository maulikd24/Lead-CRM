import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MasterDetail, StickyActionBar, type MasterItem } from "@/components/workspace";
import { EVENT_LABEL, type ReferralEventType } from "@/lib/referrals/state-machine";
import { formatRupees, readyLabel } from "@/lib/referrals/summary";
import type { ReadyRow, StatementView } from "@/lib/referrals/views";

import { PrepareStatement, StatementStep } from "./controls";
import { Trailing } from "./trailing";

const monthName = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const STATUS = { PREPARED: { label: "Needs a second person", variant: "warning" }, APPROVED: { label: "Approved, pay outside the CRM", variant: "secondary" }, PAID: { label: "Marked paid", variant: "success" } } as const;

/** The status as it fits in a list row; the detail pane spells it out. */
const SHORT = { PREPARED: "Needs approval", APPROVED: "Approved", PAID: "Marked paid" } as const;

function Ready({ period, ready, canPrepare }: { period: string; ready: ReadyRow[]; canPrepare: boolean }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="font-heading text-base font-semibold">Ready for {monthName(period)}</p>
      {ready.length === 0 ? (
        <p className="text-muted-foreground">Nothing is waiting. Rewards in review are not included until someone clears them.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ready.map((r) => (
            <li key={r.referrerId} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {r.referrerName} <span className="text-muted-foreground tabular-nums">{readyLabel(r.paise).text} in {r.count} {r.count === 1 ? "line" : "lines"}{r.recoveries > 0 ? `, ${r.recoveries} taken back` : ""}</span>
              </span>
              {canPrepare && readyLabel(r.paise).payable && <PrepareStatement referrerId={r.referrerId} period={period} again={r.hasStatement} />}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">A reward that was already approved and is later taken back (a clawback) shows here as a negative line and is netted off. If the lines add up to nothing or less, no statement is made and the balance carries forward.</p>
    </div>
  );
}

function Detail({ s, canApprove, viewerId }: { s: StatementView; canApprove: boolean; viewerId: string }) {
  const own = s.status === "PREPARED" && s.preparedById === viewerId;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-heading text-base font-semibold">{s.referrerName}</p>
          <p className="text-muted-foreground">{monthName(s.period)}</p>
        </div>
        <Badge variant={STATUS[s.status].variant}>{STATUS[s.status].label}</Badge>
      </div>
      <p className="font-heading text-2xl font-semibold tabular-nums">{formatRupees(s.totalPaise)}</p>
      <p className="text-muted-foreground">
        Prepared by {s.preparedBy}
        {s.approvedBy ? `, approved by ${s.approvedBy}` : ""}
        {s.bankReference ? `. Bank reference ${s.bankReference}` : ""}.
      </p>
      <ul className="flex flex-col gap-1 border-l border-border pl-3" aria-label="Lines on this statement">
        {s.lines.map((l, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 text-xs">
            <span>{l.kind === "RECOVERY" ? "Taken back" : "Reward"}: {l.event ? (EVENT_LABEL[l.event as ReferralEventType] ?? l.event) : "reward"}</span>
            <span className="tabular-nums">{formatRupees(l.amountPaise)}</span>
          </li>
        ))}
      </ul>
      {canApprove && (own ? <p className="text-xs text-muted-foreground">You prepared this: someone else approves.</p> : <div><StatementStep id={s.id} status={s.status} canApprove /></div>)}
      <p className="text-xs text-muted-foreground">Someone other than the person who prepared a statement has to approve it. Marking it paid only records the bank reference of a payment finance made elsewhere: this system never moves money.</p>
    </div>
  );
}

export function StatementsTab({ period, ready, statements, canPrepare, canApprove, viewerId }: { period: string; ready: ReadyRow[]; statements: StatementView[]; canPrepare: boolean; canApprove: boolean; viewerId: string }) {
  const items: MasterItem[] = [
    { id: "ready", title: `Ready for ${monthName(period)}`, meta: ready.length === 0 ? "Nothing waiting" : `${ready.length} ${ready.length === 1 ? "referrer" : "referrers"}`, trailing: ready.length > 0 ? <Trailing chips={[{ label: String(ready.length), variant: "secondary" }]} /> : undefined },
    ...statements.map((s) => ({ id: s.id, title: s.referrerName, meta: `${monthName(s.period)} · ${s.lineCount} ${s.lineCount === 1 ? "line" : "lines"}`, trailing: <Trailing amount={formatRupees(s.totalPaise)} chips={[{ label: SHORT[s.status], variant: STATUS[s.status].variant }]} /> })),
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <MasterDetail idPrefix="st" label="Statements" noun="statements" items={items} details={{ ready: <Ready period={period} ready={ready} canPrepare={canPrepare} />, ...Object.fromEntries(statements.map((s) => [s.id, <Detail key={s.id} s={s} canApprove={canApprove} viewerId={viewerId} />])) }} />
      {canPrepare && (
        <StickyActionBar phoneOnly label="Statement actions">
          <Button size="lg" render={<Link href="?tab=statements&item=ready&sheet=st-detail" scroll={false} />}>
            {ready.length > 0 ? `Ready (${ready.length})` : "Ready"}
          </Button>
        </StickyActionBar>
      )}
    </div>
  );
}
