import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CountUp, DrawIn, motion } from "@/components/workspace";
import { funnelSteps, formatRupees } from "@/lib/referrals/summary";
import type { OverviewData } from "@/lib/referrals/views";

const REASON_TEXT: Record<string, string> = {
  UNKNOWN_CODE: "Code not recognised",
  CODE_NOT_YET_ISSUED: "Signed up before the code existed",
  CODE_REVOKED: "Code was revoked",
  REFERRER_INACTIVE: "Referrer was suspended",
  SELF_REFERRAL: "Referred themselves",
  ALREADY_CUSTOMER: "Already a customer",
  ALREADY_ATTRIBUTED: "Already credited to someone else",
};

function Funnel({ data }: { data: OverviewData["funnel"] }) {
  const steps = funnelSteps(data);
  return (
    <Card size="sm" className={motion.enter}>
      <CardHeader>
        <CardTitle className="font-heading text-sm">From sign-up to first funding</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-3">
          {steps.map((s, i) => (
            <li key={s.key} className="flex flex-col gap-1">
              <span className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{s.label}</span>
                <span className="tabular-nums">
                  <span className="font-heading text-lg font-semibold"><CountUp value={s.value} label={s.label} /></span>
                  {s.fromPrevious !== null && <span className="ml-1.5 text-muted-foreground">{Math.round(s.fromPrevious * 100)}% of the step before</span>}
                </span>
              </span>
              <div className="h-2.5 rounded-full bg-muted" aria-hidden>
                <div className={`${motion.growX} h-full rounded-full bg-primary`} style={{ width: `${Math.max(s.value > 0 ? 2 : 0, s.widthPct)}%`, ["--i" as string]: i, opacity: 1 - i * 0.18 }} />
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">Counts people credited to a referrer. KYC and funding come from the customer record; nothing is added by hand.</p>
      </CardContent>
    </Card>
  );
}

function Weekly({ weekly }: { weekly: number[] }) {
  const max = Math.max(1, ...weekly);
  const w = 240;
  const h = 64;
  const bar = w / weekly.length;
  const total = weekly.reduce((a, b) => a + b, 0);
  return (
    <Card size="sm" className={motion.enter} style={{ ["--i" as string]: 1 }}>
      <CardHeader>
        <CardTitle className="font-heading text-sm">New referrals by week</CardTitle>
      </CardHeader>
      <CardContent>
        <DrawIn>
          <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`New referrals per week over the last ${weekly.length} weeks: ${weekly.join(", ")}`} className="h-20 w-full">
            {weekly.map((v, i) => {
              const bh = v === 0 ? 1.5 : Math.max(3, (v / max) * (h - 8));
              return <rect key={i} x={i * bar + 4} y={h - bh} width={bar - 8} height={bh} rx={2} className={`${motion.growY} fill-primary`} style={{ ["--i" as string]: i, opacity: v === 0 ? 0.25 : 1 }} />;
            })}
          </svg>
        </DrawIn>
        <p className="mt-2 text-xs text-muted-foreground">{total} in the last {weekly.length} weeks. Oldest week on the left.</p>
      </CardContent>
    </Card>
  );
}

function Money({ data }: { data: OverviewData }) {
  const rows: [string, number, number][] = [
    ["Waiting for review", data.ledger.needsReview.paise, data.ledger.needsReview.count],
    ["Accrued, not yet on a statement", data.ledger.accrued.paise, data.ledger.accrued.count],
    ["Approved, awaiting payment", data.ledger.approved.paise, data.ledger.approved.count],
    ["Marked paid", data.ledger.paid.paise, data.ledger.paid.count],
  ];
  return (
    <Card size="sm" className={motion.enter} style={{ ["--i" as string]: 2 }}>
      <CardHeader>
        <CardTitle className="font-heading text-sm">Rewards</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-2 text-sm">
          {rows.map(([label, paise, count]) => (
            <div key={label} className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="tabular-nums">
                <span className="font-heading font-semibold">{formatRupees(paise)}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">{count} {count === 1 ? "reward" : "rewards"}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">The CRM records what is owed. Payment happens outside it, and "paid" is only a note with the bank reference.</p>
      </CardContent>
    </Card>
  );
}

function Rejected({ data }: { data: OverviewData["rejected"] }) {
  return (
    <Card size="sm" className={motion.enter} style={{ ["--i" as string]: 3 }}>
      <CardHeader>
        <CardTitle className="font-heading text-sm">Codes that were not credited</CardTitle>
      </CardHeader>
      <CardContent>
        {data.total === 0 ? (
          <p className="text-sm text-muted-foreground">None so far.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {data.byReason.map((r) => (
              <li key={r.reason} className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">{REASON_TEXT[r.reason] ?? r.reason}</span>
                <span className="tabular-nums">{r.count}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function OverviewTab({ data, hasRules }: { data: OverviewData; hasRules: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {!hasRules && (
        <Card size="sm" className={motion.enter}>
          <CardContent className="text-sm">
            <p className="font-medium">No reward rules yet, so nothing accrues.</p>
            <p className="text-muted-foreground">Referrals and their KYC and funding steps are still recorded. Add a rule under Rules when the amounts are decided.</p>
          </CardContent>
        </Card>
      )}
      <div className="@container grid gap-4 @2xl:grid-cols-2">
        <Funnel data={data.funnel} />
        <Weekly weekly={data.weekly} />
        <Money data={data} />
        <Rejected data={data.rejected} />
      </div>
    </div>
  );
}
