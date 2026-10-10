import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CountUp, MasterDetail, type MasterItem } from "@/components/workspace";
import { customer360Enabled } from "@/lib/c360/flag";
import { STATIC_COPY } from "@/lib/outcomes/copy";
import { loadAttentionList, type AttentionRow } from "@/lib/outcomes/loaders";
import { topScoreReasons } from "@/lib/outcomes/risk";
import { cn } from "@/lib/utils";


const BAND = { high: { variant: "warning", label: "High" }, medium: { variant: "secondary", label: "Medium" }, low: { variant: "outline", label: "Low" } } as const;

/**
 * "Needs attention today" for the Today workspace. Scoped to the viewer exactly like the rest of Today: `visibleUserIds`
 * is null for an admin, a manager's team for a manager and the RM's own id for an RM. It only lists customers; it sends nothing.
 */
export async function NeedsAttentionCard({ visibleUserIds, showRm }: { visibleUserIds: string[] | null; showRm: boolean }) {
  const list = await loadAttentionList(visibleUserIds);
  const to360 = customer360Enabled();
  const hrefFor = (r: AttentionRow) => (to360 ? `/clients/${r.clientId}/360?tab=outcomes` : `/clients/${r.clientId}`);
  const items: MasterItem[] = list.rows.map((r) => {
    const band = BAND[r.score.band];
    return {
      id: r.clientId,
      title: r.name,
      meta: [r.tierLabel, showRm ? `RM: ${r.rmName ?? "Unassigned"}` : null, r.suggestions[0]?.title].filter(Boolean).join(" · "),
      trailing: <Badge variant={band.variant}>{band.label} {r.score.score}</Badge>,
    };
  });
  const details = Object.fromEntries(list.rows.map((r) => [r.clientId, <Detail key={r.clientId} row={r} showRm={showRm} href={hrefFor(r)} />]));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">From fixed rules, not AI</p>
          <h2 className="font-heading text-lg font-semibold leading-tight">{STATIC_COPY.attentionTitle}</h2>
          <p className="text-xs text-muted-foreground max-lg:hidden">{STATIC_COPY.attentionIntro}</p>
        </div>
        <dl className="flex gap-x-6">
          <Count label="Need attention" value={list.total} />
          <Count label="High" value={list.counts.high} tone="text-warning" />
          <Count label="Medium" value={list.counts.medium} />
        </dl>
      </div>
      {list.rows.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 aria-hidden className="size-4 text-success" />
          {STATIC_COPY.attentionEmpty}
        </p>
      ) : (
        <MasterDetail idPrefix="attention" label="Customers needing attention" items={items} details={details} noun="customers" />
      )}
      {list.capped && <p className="text-xs text-muted-foreground">Showing the most recently updated {list.scanned} customers.</p>}
      {list.total > list.rows.length && <p className="text-xs text-muted-foreground">{list.total - list.rows.length} more not shown.</p>}
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("font-heading text-xl font-semibold leading-tight", tone)}>
        <CountUp value={value} label={label} />
      </dd>
    </div>
  );
}

/** The selected customer in full: the score with every factor it is made of, the suggestions with the inputs they looked at, and the way in. */
function Detail({ row, showRm, href }: { row: AttentionRow; showRm: boolean; href: string }) {
  const band = BAND[row.score.band];
  const factors = [...row.score.factors].sort((a, b) => b.points - a.points);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-heading text-lg font-semibold">{row.name}</h3>
          <p className="text-xs text-muted-foreground">
            {[row.tierLabel, showRm ? `RM: ${row.rmName ?? "Unassigned"}` : null].filter(Boolean).join(" · ") || "No review tier yet"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={band.variant}>{band.label} {row.score.score}</Badge>
          <Link href={href} className={buttonVariants({ size: "sm" })}>Open customer</Link>
        </div>
      </div>

      <section aria-label="Why this score" className="flex flex-col gap-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Why this score</h4>
        <ul className="list-disc space-y-0.5 pl-4 text-sm">
          {topScoreReasons(row.score).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full min-w-[20rem] text-left text-xs">
            <caption className="sr-only">Each factor in the attention score, its weight, the points it added and what it looked at</caption>
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 pr-2 font-medium">Factor</th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">Weight</th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">Points</th>
                <th scope="col" className="py-1 font-medium">What it looked at</th>
              </tr>
            </thead>
            <tbody>
              {factors.map((f) => (
                <tr key={f.key} className="border-t border-border align-top">
                  <th scope="row" className="py-1.5 pr-2 font-medium">{f.label}</th>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{f.weight}</td>
                  <td className={cn("py-1.5 pr-2 text-right tabular-nums", f.points > 0 && "font-semibold")}>{f.points}</td>
                  <td className="py-1.5 text-muted-foreground">{f.input}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="Suggestions" className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suggestions</h4>
        {row.suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to do for this customer right now.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {row.suggestions.map((s) => (
              <li key={`${s.ruleKey}:${s.fingerprint}`} className="rounded-md border border-border p-3 text-sm">
                <p className="font-medium">{s.title}</p>
                <dl className="mt-1.5 grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-0.5 text-xs">
                  {s.why.map((w) => (
                    <div key={w.label} className="contents">
                      <dt className="text-muted-foreground">{w.label}</dt>
                      <dd className="font-medium">{w.value}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function NeedsAttentionCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-1 h-5 w-48" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
