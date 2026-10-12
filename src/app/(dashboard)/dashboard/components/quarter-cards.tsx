import { cache } from "react";
import Link from "next/link";
import { AlertTriangle, Target } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { MotionNumber } from "@/components/motion/motion-number";
import { GrowBar } from "@/components/motion/grow-bar";
import { formatInrCompact } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { getQuarterScoreboard } from "@/lib/targets/scoreboard";
import { quarterOf } from "@/lib/targets/quarter";
import { getPipelineBoard } from "@/lib/pipeline/board";

type Viewer = { id: string; role: string };
// The hero and quota cards share one scoreboard per request.
const scoreboard = cache((viewer: Viewer, visibleUserIds: string[] | null) => getQuarterScoreboard(viewer, visibleUserIds, quarterOf(new Date())));
const canSetTargets = (role: string) => role === "ADMIN" || role === "MANAGER";

/** Funded this quarter against the target — the RM's own, a Manager's team, an Admin's firm. */
export async function QuarterHeroCard({ viewer, visibleUserIds }: { viewer: Viewer; visibleUserIds: string[] | null }) {
  const s = await scoreboard(viewer, visibleUserIds);
  const whose = viewer.role === "RM" ? "Your" : viewer.role === "MANAGER" ? "Team" : "Firm";
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {whose} funding · {s.quarter.label}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <MotionNumber value={s.funded} format="inr-compact" className="font-heading text-3xl font-semibold" />
          <p className="text-sm text-muted-foreground tabular-nums">
            {s.target > 0 ? <>of {formatInrCompact(s.target)} target · {s.progress.pct}%</> : "No target set"}
          </p>
        </div>
        {s.target > 0 && <Track pct={s.progress.pct ?? 0} />}
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Accounts funded</dt>
            <dd className="font-semibold tabular-nums">
              <MotionNumber value={s.accounts} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Average ticket</dt>
            <dd className="font-semibold tabular-nums">{s.avgTicket ? formatInrCompact(s.avgTicket) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Days left</dt>
            <dd className="font-semibold tabular-nums">
              <MotionNumber value={s.progress.daysLeft} />
            </dd>
          </div>
        </dl>
        {s.progress.perDayNeeded !== null && (
          <p className="text-sm text-muted-foreground">
            {formatInrCompact(s.progress.remaining)} to go — about {formatInrCompact(s.progress.perDayNeeded)} a day.
          </p>
        )}
        {s.target > 0 && s.progress.remaining === 0 && <p className="text-sm font-medium text-success">Target reached.</p>}
        {canSetTargets(viewer.role) && s.rmsWithoutTarget > 0 && (
          <p className="text-xs text-muted-foreground">
            {s.rmsWithoutTarget} RM{s.rmsWithoutTarget === 1 ? " has" : "s have"} no target this quarter.{" "}
            <Link href={`/settings/targets?quarter=${s.quarter.key}`} className="text-primary underline-offset-2 hover:underline">
              Set targets
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Managers and Admins: every RM in scope. An RM: their own progress and rank only. */
export async function QuotaCard({ viewer, visibleUserIds }: { viewer: Viewer; visibleUserIds: string[] | null }) {
  const s = await scoreboard(viewer, visibleUserIds);
  const lb = s.leaderboard;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Quota · {s.quarter.label}</CardTitle>
        {canSetTargets(viewer.role) && (
          <Link href={`/settings/targets?quarter=${s.quarter.key}`} className="text-xs text-primary underline-offset-2 hover:underline">
            Targets
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {lb.kind === "self" ? (
          lb.row ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                You&apos;re <span className="font-semibold">#{lb.row.rank}</span> of {lb.of} RMs by funded amount this quarter.
              </p>
              <QuotaRow name="You" funded={lb.row.funded} target={lb.row.target} index={0} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Your rank shows once you&apos;re set up as an active RM.</p>
          )
        ) : lb.rows.length === 0 ? (
          <EmptyState icon={Target} title="No RMs yet" description="RMs in your team will appear here with their funding against target." />
        ) : (
          <ol className="flex flex-col gap-3">
            {lb.rows.map((r, i) => (
              <li key={r.rmId} className="flex gap-2">
                <span className="w-5 shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">{r.rank}</span>
                <QuotaRow name={r.name} funded={r.funded} target={r.target} href={`/reports/rm/${r.rmId}`} index={i} />
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function QuotaRow({ name, funded, target, href, index }: { name: string; funded: number; target: number; href?: string; index: number }) {
  const pct = target > 0 ? Math.round((funded / target) * 100) : null;
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        {href ? (
          <Link href={href} className="truncate font-medium hover:underline">
            {name}
          </Link>
        ) : (
          <span className="truncate font-medium">{name}</span>
        )}
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatInrCompact(funded)} / {target > 0 ? formatInrCompact(target) : "no target"}
          {pct !== null && ` · ${pct}%`}
        </span>
      </div>
      {pct !== null && (
        <div className="-mt-2">
          {/* Bars grow in one after another, like the reel's leaderboard. */}
          <Track pct={pct} delayMs={index * 60} />
        </div>
      )}
    </div>
  );
}

/** Expected investment sitting with overdue clients right now — the same "At risk" as the pipeline board. */
export async function CouldSlipCard({ viewer, visibleUserIds }: { viewer: Viewer; visibleUserIds: string[] | null }) {
  const columns = (await getPipelineBoard({ userId: viewer.id, role: viewer.role, visibleUserIds, filter: "at-risk" })).slice(0, -1);
  const total = columns.reduce((s, c) => s + c.totalExpected, 0);
  const count = columns.reduce((s, c) => s + c.count, 0);
  const top = columns
    .flatMap((c) => c.cards.map((card) => ({ ...card, stage: c.name })))
    .sort((a, b) => (b.expectedInvestment ?? 0) - (a.expectedInvestment ?? 0))
    .slice(0, 3);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Could slip</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {count === 0 ? (
          <EmptyState icon={AlertTriangle} title="Nothing overdue" description="No onboarding client is past their stage's SLA." />
        ) : (
          <>
            <p className="text-sm">
              <MotionNumber value={total} format="inr-compact" className="font-semibold" /> expected from{" "}
              <MotionNumber value={count} className="font-semibold" /> client{count === 1 ? "" : "s"} past their stage&apos;s SLA.
            </p>
            <ul className="flex flex-col divide-y rounded-lg border">
              {top.map((c) => (
                <li key={c.id}>
                  <Link href={`/clients/${c.id}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="text-xs text-muted-foreground">{c.stage}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">{c.expectedInvestment ? formatInrCompact(c.expectedInvestment) : "—"}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link href="/pipeline?filter=at-risk" className="text-sm text-primary underline-offset-2 hover:underline">
              Review on the pipeline board
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const STAGE_TONES = ["bg-primary/30", "bg-primary/45", "bg-primary/60", "bg-primary/75", "bg-primary/90"];

/** Where the expected investment of everyone still onboarding sits, stage by stage. */
export async function OpenPipelineCard({ viewer, visibleUserIds }: { viewer: Viewer; visibleUserIds: string[] | null }) {
  const columns = (await getPipelineBoard({ userId: viewer.id, role: viewer.role, visibleUserIds, filter: "all" })).slice(0, -1);
  const total = columns.reduce((s, c) => s + c.totalExpected, 0);
  const likely = columns.reduce((s, c) => s + (c.weightedExpected ?? 0), 0);
  const hasLikely = columns.some((c) => c.weightedExpected !== null);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Open pipeline</CardTitle>
        <Link href="/pipeline" className="text-xs text-primary underline-offset-2 hover:underline">
          Open board
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm">
          <MotionNumber value={total} format="inr-compact" className="font-heading text-2xl font-semibold" />
          <span className="text-muted-foreground"> expected{hasLikely ? ` · ~${formatInrCompact(likely)} likely` : ""}</span>
        </p>
        {total > 0 && (
          <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label="Expected investment by stage">
            {columns.map((c, i) => (
              <GrowBar key={c.stageId} pct={(c.totalExpected / total) * 100} delayMs={i * 60} className={STAGE_TONES[i % STAGE_TONES.length]} />
            ))}
          </div>
        )}
        <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
          {columns.map((c, i) => (
            <li key={c.stageId} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={cn("size-2 shrink-0 rounded-full", STAGE_TONES[i % STAGE_TONES.length])} aria-hidden />
                <span className="truncate">{c.name}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {c.count} · {formatInrCompact(c.totalExpected)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** The shared progress bar's look, with a fill that grows in (static with motion off). */
function Track({ pct, delayMs = 0 }: { pct: number; delayMs?: number }) {
  return (
    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
      <GrowBar pct={pct} delayMs={delayMs} className="rounded-full bg-primary" />
    </div>
  );
}

export function QuarterCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn(className)}>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </CardContent>
    </Card>
  );
}
