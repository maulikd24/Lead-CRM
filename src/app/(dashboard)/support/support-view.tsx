"use client";

import { Headset } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SlaBar, SlaRing, SlaStyles } from "@/components/support/sla-visuals";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CountUp, motion, RailCard, RailFact, StickyRail, useUrlTab, WorkspacePanel, WorkspaceShell, WorkspaceTabs } from "@/components/workspace";
import { computeSupportStats, type SupportRow } from "@/lib/integrations/freshdesk/ticket-view";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/utils/format";
import { partitionSupport, SUPPORT_TAB_KEYS, SUPPORT_TABS, type BreachingRow } from "./support-model";

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
const TITLE = "Support SLA";
const DESCRIPTION = "Hand-offs from the support assistant: who is waiting, and which clocks are slipping.";

function Header() {
  return <PageHeader title={TITLE} description={DESCRIPTION} />;
}

function Heading({ row }: { row: SupportRow }) {
  const v = row.view;
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium">
        {row.clientName} <span className="font-normal text-muted-foreground">· {v.intent || v.subject || `#${v.ticketId}`}</span>
      </p>
      <p className="text-xs text-muted-foreground">
        {row.rmName ?? "Unassigned"} · handed off {formatDateTime(v.handoffAt)} · <Badge variant={v.priority === "urgent" ? "destructive" : "outline"}>{v.priority}</Badge>
      </p>
    </div>
  );
}

function RowList({ label, empty, children, count }: { label: string; empty: string; children: React.ReactNode; count: number }) {
  return (
    <Card>
      <CardContent>
        {count === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul aria-label={label} className="flex flex-col divide-y divide-border">
            {children}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const ROW = "grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_18rem] sm:items-center";

function QueueSection({ rows, now }: { rows: SupportRow[]; now: Date }) {
  return (
    <RowList label="Waiting for an RM" empty="Every open hand-off has been picked up." count={rows.length}>
      {rows.map((r, i) => (
        <li key={r.view.activityId} className={cn(ROW, motion.enter)} style={{ ["--i" as string]: i }}>
          <Heading row={r} />
          <SlaBar label="First response" start={r.view.handoffAt} due={r.view.firstResponseDueAt} now={now} />
        </li>
      ))}
    </RowList>
  );
}

function BreachingSection({ rows, now }: { rows: BreachingRow[]; now: Date }) {
  return (
    <RowList label="Breaching hand-offs" empty="No open hand-off has breached a clock." count={rows.length}>
      {rows.map(({ row, firstResponse, resolution }, i) => (
        <li key={row.view.activityId} className={cn(ROW, motion.enter)} style={{ ["--i" as string]: i }}>
          <Heading row={row} />
          <div className="flex flex-col gap-2">
            {firstResponse && <SlaBar label="First response" start={row.view.handoffAt} due={row.view.firstResponseDueAt} now={now} doneAt={row.taskDone ? row.taskDoneAt : null} />}
            {resolution && <SlaBar label="Resolution" start={row.view.handoffAt} due={row.view.resolutionDueAt} now={now} />}
          </div>
        </li>
      ))}
    </RowList>
  );
}

function ResolvedSection({ rows }: { rows: SupportRow[] }) {
  return (
    <RowList label="Resolved hand-offs" empty="Nothing has been resolved in the last 90 days." count={rows.length}>
      {rows.map((r, i) => (
        <li key={r.view.activityId} className={cn("flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm", motion.enter)} style={{ ["--i" as string]: Math.min(i, 8) }}>
          <span className="min-w-0">
            <span className="font-medium">{r.clientName}</span>
            <span className="text-muted-foreground"> · {r.view.intent || r.view.subject || `#${r.view.ticketId}`}</span>
          </span>
          <span className="text-xs text-muted-foreground">
            {r.rmName ?? "Unassigned"} · {r.view.resolvedAt ? `resolved ${formatDateTime(r.view.resolvedAt)}` : "resolved"}
          </span>
        </li>
      ))}
    </RowList>
  );
}

function WorkloadSection({ stats }: { stats: ReturnType<typeof computeSupportStats> }) {
  const maxLoad = Math.max(1, ...stats.perRm.map((r) => r.open));
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card className={motion.enter}>
        <CardHeader>
          <CardTitle className="font-heading">Open by priority and status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-wrap gap-2" aria-label="Open tickets by priority">
            {PRIORITIES.map((p) => (
              <li key={p}>
                <Badge variant={p === "urgent" ? "destructive" : p === "high" ? "warning" : "outline"}>
                  {p} · {stats.byPriority[p]}
                </Badge>
              </li>
            ))}
          </ul>
          <ul className="flex flex-wrap gap-2" aria-label="Open tickets by status">
            {Object.entries(stats.byStatus).length === 0 ? (
              <li className="text-sm text-muted-foreground">Nothing open.</li>
            ) : (
              Object.entries(stats.byStatus).map(([k, v]) => (
                <li key={k}>
                  <Badge variant="secondary">
                    {k} · {v}
                  </Badge>
                </li>
              ))
            )}
          </ul>
        </CardContent>
      </Card>

      <Card className={motion.enter} style={{ ["--i" as string]: 1 }}>
        <CardHeader>
          <CardTitle className="font-heading">Load per RM</CardTitle>
          <CardDescription>Open hand-offs; the darker part has already breached an SLA.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {stats.perRm.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open hand-offs.</p>
          ) : (
            stats.perRm.map((r) => (
              <div key={r.rmId ?? "none"} className="flex flex-col gap-1">
                <div className="flex justify-between gap-3 text-sm">
                  <span>{r.rmName}</span>
                  <span className="text-muted-foreground">
                    {r.open} open · {r.waiting} waiting{r.breached ? ` · ${r.breached} breached` : ""}
                  </span>
                </div>
                <div className="fd-bar h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${r.rmName} open load`} aria-valuemin={0} aria-valuemax={maxLoad} aria-valuenow={r.open} style={{ ["--fd-w" as string]: `${(r.open / maxLoad) * 100}%` }}>
                  <span className="block h-full rounded-full" style={{ background: r.breached ? "var(--destructive)" : "var(--primary)" }} />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** The manager support view as a tabbed workspace. All numbers come from computeSupportStats; the sections come from partitionSupport. */
export function SupportView({ rows, now }: { rows: SupportRow[]; now: Date }) {
  const { tab, select, hrefFor } = useUrlTab(SUPPORT_TAB_KEYS, "queue");

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <Card>
          <CardContent>
            <EmptyState icon={Headset} title="No support hand-offs yet" description="Connect Freshdesk and enable hand-offs. When the support assistant passes a chat to a person it will appear here, with its SLA clock." action={{ label: "Open integrations", href: "/settings/integrations" }} />
          </CardContent>
        </Card>
      </div>
    );
  }

  const stats = computeSupportStats(rows, now);
  const parts = partitionSupport(rows, now);
  const tabs = SUPPORT_TABS.map((t) => ({ ...t, count: t.key === "queue" ? parts.queue.length : t.key === "breaching" ? parts.breaching.length : t.key === "resolved" ? parts.resolved.length : null }));

  const rail = (
    <StickyRail
      label="SLA key figures"
      facts={
        <>
          <RailFact label="Open hand-offs" index={0}>
            <CountUp value={stats.open} />
          </RailFact>
          <RailFact label="Waiting for an RM" index={1}>
            <CountUp value={stats.waitingForRm} />
          </RailFact>
          <RailFact label="First-response breaches" tone={stats.firstResponseBreaches > 0 ? "destructive" : "default"} index={2}>
            <CountUp value={stats.firstResponseBreaches} />
          </RailFact>
          <RailFact label="Resolution breaches" tone={stats.resolutionBreaches > 0 ? "destructive" : "default"} index={3}>
            <CountUp value={stats.resolutionBreaches} />
          </RailFact>
        </>
      }
    >
      <RailCard title="SLA compliance" labelId="support-rail-sla" index={4}>
        <div className="flex items-center gap-4">
          <SlaRing pct={stats.compliancePct} />
          <p className="text-xs text-muted-foreground">Share of the last 90 days of hand-offs with no first-response or resolution breach.</p>
        </div>
      </RailCard>
    </StickyRail>
  );

  return (
    <WorkspaceShell
      header={<Header />}
      rail={rail}
      tabs={<WorkspaceTabs tabs={tabs} active={tab} idPrefix="support" label="Support sections" hrefFor={hrefFor} onSelect={select} />}
    >
      <SlaStyles />
      <WorkspacePanel tab={tab} idPrefix="support">
        {tab === "queue" && <QueueSection rows={parts.queue} now={now} />}
        {tab === "breaching" && <BreachingSection rows={parts.breaching} now={now} />}
        {tab === "resolved" && <ResolvedSection rows={parts.resolved} />}
        {tab === "workload" && <WorkloadSection stats={stats} />}
      </WorkspacePanel>
    </WorkspaceShell>
  );
}
