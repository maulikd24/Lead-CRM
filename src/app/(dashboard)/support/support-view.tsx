import { ChevronDown, Headset } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { SlaBar, SlaRing, SlaStyles, CountUp } from "@/components/support/sla-visuals";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { computeSupportStats, isOpenStatus, type SupportRow } from "@/lib/integrations/freshdesk/ticket-view";
import { formatDateTime } from "@/lib/utils/format";

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;

function Stat({ label, value, tone }: { label: string; value: number; tone?: "bad" }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1 px-4">
        <span className="text-xs text-muted-foreground">{label}</span>
        <CountUp value={value} className={`font-heading text-3xl ${tone === "bad" && value > 0 ? "text-destructive" : ""}`} />
      </CardContent>
    </Card>
  );
}

/** Pure presentation of the manager support view. All numbers come from computeSupportStats. */
export function SupportView({ rows, now }: { rows: SupportRow[]; now: Date }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyState icon={Headset} title="No support hand-offs yet" description="Connect Freshdesk and enable hand-offs. When the support assistant passes a chat to a person it will appear here, with its SLA clock." action={{ label: "Open integrations", href: "/settings/integrations" }} />
        </CardContent>
      </Card>
    );
  }
  const s = computeSupportStats(rows, now);
  const waiting = rows.filter((r) => isOpenStatus(r.view.status) && !r.taskDone).sort((a, b) => a.view.firstResponseDueAt.getTime() - b.view.firstResponseDueAt.getTime()).slice(0, 8);
  const resolved = rows.filter((r) => !isOpenStatus(r.view.status)).sort((a, b) => (b.view.resolvedAt ?? b.view.handoffAt).getTime() - (a.view.resolvedAt ?? a.view.handoffAt).getTime()).slice(0, 25);
  const maxLoad = Math.max(1, ...s.perRm.map((r) => r.open));

  return (
    <div className="flex flex-col gap-6">
      <SlaStyles />
      <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
        <Card>
          <CardContent className="flex items-center gap-5 py-2">
            <SlaRing pct={s.compliancePct} />
            <p className="max-w-[12rem] text-sm text-muted-foreground">Share of the last 90 days of hand-offs with no first-response or resolution breach.</p>
          </CardContent>
        </Card>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Open hand-offs" value={s.open} />
          <Stat label="Waiting for an RM" value={s.waitingForRm} />
          <Stat label="First-response breaches" value={s.firstResponseBreaches} tone="bad" />
          <Stat label="Resolution breaches" value={s.resolutionBreaches} tone="bad" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-heading">Open by priority and status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ul className="flex flex-wrap gap-2" aria-label="Open tickets by priority">
              {PRIORITIES.map((p) => (
                <li key={p}><Badge variant={p === "urgent" ? "destructive" : p === "high" ? "warning" : "outline"}>{p} · {s.byPriority[p]}</Badge></li>
              ))}
            </ul>
            <ul className="flex flex-wrap gap-2" aria-label="Open tickets by status">
              {Object.entries(s.byStatus).length === 0 ? <li className="text-sm text-muted-foreground">Nothing open.</li> : Object.entries(s.byStatus).map(([k, v]) => <li key={k}><Badge variant="secondary">{k} · {v}</Badge></li>)}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading">Load per RM</CardTitle>
            <CardDescription>Open hand-offs; the darker part has already breached an SLA.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {s.perRm.length === 0 ? <p className="text-sm text-muted-foreground">No open hand-offs.</p> : s.perRm.map((r) => (
              <div key={r.rmId ?? "none"} className="flex flex-col gap-1">
                <div className="flex justify-between text-sm"><span>{r.rmName}</span><span className="text-muted-foreground">{r.open} open · {r.waiting} waiting{r.breached ? ` · ${r.breached} breached` : ""}</span></div>
                <div className="fd-bar h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${r.rmName} open load`} aria-valuemin={0} aria-valuemax={maxLoad} aria-valuenow={r.open} style={{ ["--fd-w" as string]: `${(r.open / maxLoad) * 100}%` }}>
                  <span className="block h-full rounded-full" style={{ background: r.breached ? "var(--destructive)" : "var(--primary)" }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Waiting for an RM</CardTitle>
          <CardDescription>Most urgent first-response clock at the top.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {waiting.length === 0 ? <p className="text-sm text-muted-foreground">Every open hand-off has been picked up.</p> : waiting.map((r) => (
            <div key={r.view.activityId} className="fd-enter grid gap-2 sm:grid-cols-[1fr_18rem] sm:items-center">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.clientName} <span className="font-normal text-muted-foreground">· {r.view.intent || r.view.subject || `#${r.view.ticketId}`}</span></p>
                <p className="text-xs text-muted-foreground">{r.rmName ?? "Unassigned"} · handed off {formatDateTime(r.view.handoffAt)} · <Badge variant={r.view.priority === "urgent" ? "destructive" : "outline"}>{r.view.priority}</Badge></p>
              </div>
              <SlaBar label="First response" start={r.view.handoffAt} due={r.view.firstResponseDueAt} now={now} />
            </div>
          ))}
        </CardContent>
      </Card>

      {resolved.length > 0 && (
        <Card>
          <CardContent>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                <span className="font-heading text-base font-medium">Resolved ({resolved.length})</span>
                <ChevronDown aria-hidden className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
              </summary>
              <ul className="mt-4 divide-y divide-border">
                {resolved.map((r) => (
                  <li key={r.view.activityId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium">{r.clientName}</span>
                      <span className="text-muted-foreground"> · {r.view.intent || r.view.subject || `#${r.view.ticketId}`}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{r.rmName ?? "Unassigned"} · {r.view.resolvedAt ? `resolved ${formatDateTime(r.view.resolvedAt)}` : "resolved"}</span>
                  </li>
                ))}
              </ul>
            </details>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
