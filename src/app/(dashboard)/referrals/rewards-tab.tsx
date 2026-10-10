import { Badge } from "@/components/ui/badge";
import { MasterDetail, StickyActionBar, motion, type MasterItem } from "@/components/workspace";
import { EVENT_LABEL, type ReferralEventType } from "@/lib/referrals/state-machine";
import { rowActions } from "@/lib/referrals/ledger-view";
import { formatRupees } from "@/lib/referrals/summary";
import { FLAG_TEXT, type AccrualState, type LedgerRow } from "@/lib/referrals/views";

import { LedgerButtons, RefreshButton } from "./controls";
import { Trailing } from "./trailing";

type Variant = "success" | "warning" | "outline" | "secondary" | "destructive";
const STATE: Record<AccrualState, { label: string; variant: Variant }> = {
  NEEDS_REVIEW: { label: "Needs review", variant: "warning" },
  ACCRUED: { label: "Accrued", variant: "secondary" },
  APPROVED: { label: "Approved", variant: "success" },
  PAID: { label: "Marked paid", variant: "success" },
  REVERSED: { label: "Reversed", variant: "outline" },
  CLAWED_BACK: { label: "Taken back", variant: "destructive" },
};
const KIND_LABEL: Record<string, string> = { ACCRUED: "Accrued", REVIEW_CLEARED: "Review cleared", REVERSED: "Reversed", APPROVED: "On an approved statement", PAID_MARKED: "Marked paid", CLAWBACK: "Taken back (clawback)", CLAWBACK_WAIVED: "Clawback waived" };
const CLAW_STATE = { NEEDS_REVIEW: "Waiting for a person to confirm or waive it", CONFIRMED: "Confirmed", WAIVED: "Waived" } as const;
const day = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const step = (e: string | null) => (e ? (EVENT_LABEL[e as ReferralEventType] ?? e) : "Reward");

function Detail({ r, canAct }: { r: LedgerRow; canAct: boolean }) {
  const st = STATE[r.state];
  const allowed = canAct ? rowActions(r) : [];
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-heading text-base font-semibold">{r.referrerName}</p>
          <p className="text-muted-foreground">{step(r.event)} reward for customer {r.referredCode ?? "(removed)"}</p>
        </div>
        <Badge variant={st.variant}>{st.label}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {([["Amount", formatRupees(r.amountPaise)], ["Month", r.periodMonth], ["Rule", r.ruleName ?? "None"], ["Recorded", day(r.at)], ["Clawback window ends", r.clawbackUntil ? day(r.clawbackUntil) : "No clawback"]] as const).map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {r.flags.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Why it was flagged (a flag never blocks a customer, it only holds the reward for a person to look at)</p>
          <ul className="flex flex-wrap gap-1.5">
            {r.flags.map((f) => (
              <li key={f}>
                <Badge variant="warning">{FLAG_TEXT(f)}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.clawback && (
        <div className="rounded-lg border border-border p-3" role="group" aria-label="Clawback">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            Clawback <span className="tabular-nums">{formatRupees(r.clawback.amountPaise)}</span>
            <Badge variant={r.clawback.state === "NEEDS_REVIEW" ? "warning" : r.clawback.state === "WAIVED" ? "outline" : "destructive"}>{CLAW_STATE[r.clawback.state]}</Badge>
          </p>
          {r.clawback.note && <p className="mt-1 text-muted-foreground">{r.clawback.note}</p>}
          {r.clawback.flags.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{r.clawback.flags.map(FLAG_TEXT).join(", ")}</p>}
          <p className="mt-1 text-xs text-muted-foreground">{r.clawback.taken ? "Already recovered on an approved statement." : r.clawback.state === "WAIVED" ? "Cancelled by a person; the reward stands." : "Counts against the referrer: it cancels this reward, or is netted off their next statement if it was already approved."}</p>
        </div>
      )}
      {allowed.length > 0 && <LedgerButtons referrerId={r.referrerId} entryId={r.id} clawbackId={r.clawback?.id} actions={allowed} />}
      <div>
        <p className="mb-1 text-xs text-muted-foreground">History (append-only: nothing here was edited)</p>
        <ol className="flex flex-col gap-1.5 border-l border-border pl-3">
          {r.history.map((h, i) => (
            <li key={i} className="text-xs">
              <span className="font-medium text-foreground">{KIND_LABEL[h.kind] ?? h.kind}</span>
              <span className="text-muted-foreground"> · {day(h.at)}{h.by ? ` · ${h.by}` : ""}{h.amountPaise !== 0 ? ` · ${formatRupees(h.amountPaise)}` : ""}</span>
              {h.note && <span className="block text-muted-foreground">{h.note}</span>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function RewardsTab({ rows, total, canAct }: { rows: LedgerRow[]; total: number; canAct: boolean }) {
  if (rows.length === 0) return <p className={`${motion.enter} text-sm text-muted-foreground`}>No rewards yet. They appear here when a referred person reaches a step that one of your active rules pays on.</p>;
  const waiting = rows.filter((r) => r.state === "NEEDS_REVIEW" || r.clawback?.state === "NEEDS_REVIEW").length;
  const items: MasterItem[] = rows.map((r) => ({
    id: r.id,
    title: r.referrerName,
    meta: `${step(r.event)} · ${r.referredCode ?? "removed"}`,
    trailing: <Trailing amount={formatRupees(r.clawback && r.clawback.state !== "WAIVED" ? r.clawback.amountPaise : r.amountPaise)} chips={[r.clawback?.state === "NEEDS_REVIEW" ? { label: "Clawback to review", variant: "warning" } : { label: STATE[r.state].label, variant: STATE[r.state].variant }]} />,
  }));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {waiting > 0 && (
        <p role="status" className="text-sm">
          <Badge variant="warning">{waiting} to review</Badge> <span className="text-muted-foreground">Held back from statements until someone clears or reverses them. They are listed first.</span>
        </p>
      )}
      <MasterDetail idPrefix="rw" label="Rewards" noun="rewards" items={items} details={Object.fromEntries(rows.map((r) => [r.id, <Detail key={r.id} r={r} canAct={canAct} />]))} />
      <p className="text-xs text-muted-foreground max-lg:hidden">Newest {rows.length} of {total}. The ledger is append-only: a reversal, approval or clawback is a new line, never an edit.</p>
      <StickyActionBar phoneOnly label="Rewards actions">
        <RefreshButton />
      </StickyActionBar>
    </div>
  );
}
