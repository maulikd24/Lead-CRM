import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CountUp, motion } from "@/components/workspace";
import { customer360Enabled } from "@/lib/c360/flag";
import { STATIC_COPY } from "@/lib/outcomes/copy";
import { loadAttentionList, type AttentionRow } from "@/lib/outcomes/loaders";
import { topScoreReasons } from "@/lib/outcomes/risk";
import { cn } from "@/lib/utils";

import { WhyTooltip } from "./why-tooltip";

const BAND = { high: { variant: "warning", label: "High" }, medium: { variant: "secondary", label: "Medium" }, low: { variant: "outline", label: "Low" } } as const;

/**
 * "Needs attention today" for the Today workspace. Scoped to the viewer exactly like the rest of Today: `visibleUserIds`
 * is null for an admin, a manager's team for a manager and the RM's own id for an RM. It only lists customers; it sends nothing.
 */
export async function NeedsAttentionCard({ visibleUserIds, showRm }: { visibleUserIds: string[] | null; showRm: boolean }) {
  const list = await loadAttentionList(visibleUserIds);
  const to360 = customer360Enabled();
  return (
    <Card>
      <CardHeader>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">From fixed rules, not AI</p>
        <CardTitle>{STATIC_COPY.attentionTitle}</CardTitle>
        <p className="text-xs text-muted-foreground">{STATIC_COPY.attentionIntro}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <Count label="Need attention" value={list.total} />
          <Count label="High" value={list.counts.high} tone="text-warning" />
          <Count label="Medium" value={list.counts.medium} />
        </dl>
        {list.rows.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 aria-hidden className="size-4 text-success" />
            {STATIC_COPY.attentionEmpty}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {list.rows.map((r, i) => (
              <Row key={r.clientId} row={r} index={i} showRm={showRm} href={to360 ? `/clients/${r.clientId}/360?tab=outcomes` : `/clients/${r.clientId}`} />
            ))}
          </ul>
        )}
        {list.capped && <p className="text-xs text-muted-foreground">Showing the most recently updated {list.scanned} customers.</p>}
        {list.total > list.rows.length && <p className="text-xs text-muted-foreground">{list.total - list.rows.length} more not shown.</p>}
      </CardContent>
    </Card>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("font-heading text-2xl font-semibold leading-tight", tone)}>
        <CountUp value={value} label={label} />
      </dd>
    </div>
  );
}

function Row({ row, index, showRm, href }: { row: AttentionRow; index: number; showRm: boolean; href: string }) {
  const band = BAND[row.score.band];
  const id = `attention-why-${row.clientId}`;
  const top = row.suggestions.slice(0, 2);
  return (
    <li className={cn(motion.enter, "flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0")} style={{ ["--i" as string]: index }}>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={href} className="font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{row.name}</Link>
        <Badge variant={band.variant}>{band.label} {row.score.score}</Badge>
        {row.tierLabel && <span className="text-xs text-muted-foreground">{row.tierLabel}</span>}
        {showRm && <span className="text-xs text-muted-foreground">RM: {row.rmName ?? "Unassigned"}</span>}
        <WhyTooltip id={id} className="ml-auto" align="end">
          <p className="mb-1 font-medium">Attention score {row.score.score} of 100</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {topScoreReasons(row.score).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          {top.length > 0 && (
            <>
              <p className="mb-1 mt-2 font-medium">Suggestions</p>
              <ul className="list-disc space-y-0.5 pl-4">
                {top.map((s) => (
                  <li key={`${s.ruleKey}:${s.fingerprint}`}>{s.title}: {s.why.map((w) => `${w.label} ${w.value}`).join("; ")}</li>
                ))}
              </ul>
            </>
          )}
        </WhyTooltip>
      </div>
      {top.length > 0 && <p className="text-sm text-muted-foreground">{top.map((s) => s.title).join(" · ")}</p>}
    </li>
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
