import { AlertTriangle, CheckCircle2, CircleDashed, HelpCircle, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { motion, ShowFirst } from "@/components/workspace";
import { CONFIDENCE_LABEL, CONFIDENCE_TEXT, formatWhen, kindLabel } from "@/lib/attribution/format";
import type { Journey, JourneyStep } from "@/lib/attribution/journey";
import type { Attribution, Touch } from "@/lib/attribution/model";
import { cn } from "@/lib/utils";

import { SpeedTimer } from "./speed-timer";

const STATE_ICON = { done: CheckCircle2, pending: CircleDashed, overdue: AlertTriangle, failed: XCircle, unknown: HelpCircle } as const;
const STATE_WORD: Record<JourneyStep["state"], string> = { done: "Done", pending: "Not yet", overdue: "Overdue", failed: "Failed", unknown: "Unknown" };
const STATE_TONE: Record<JourneyStep["state"], string> = { done: "text-success", pending: "text-muted-foreground", overdue: "text-destructive", failed: "text-destructive", unknown: "text-muted-foreground" };

function TouchBlock({ title, touch, empty }: { title: string; touch: Touch | null; empty: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      {touch ? (
        <>
          <p className="mt-1 break-words text-base font-semibold leading-snug">{touch.campaign?.name ?? touch.campaign?.id ?? (touch.code ? `${kindLabel(touch.kind)} ${touch.code}` : kindLabel(touch.kind))}</p>
          <p className="mt-0.5 break-words text-sm text-muted-foreground">
            {kindLabel(touch.kind)}
            {touch.creative ? <> · creative &ldquo;{touch.creative}&rdquo;</> : null}
            {touch.form && touch.campaign ? <> · form {touch.form}</> : null}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{formatWhen(new Date(touch.at))}</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

export function JourneySummary({ journey, attribution }: { journey: Journey; attribution: Attribution }) {
  const touches = attribution.status === "attributed" ? attribution.touches : [];
  const same = journey.first && journey.last && journey.first.at === journey.last.at && journey.first.kind === journey.last.kind;
  return (
    <Card role="region" aria-labelledby="journey-origin" className={cn(motion.enter)}>
      <CardHeader>
        <CardTitle id="journey-origin" className="flex flex-wrap items-center gap-2 text-base">
          Where this customer came from
          {journey.confidence ? <Badge variant={journey.confidence === "high" ? "success" : journey.confidence === "medium" ? "warning" : "outline"}>{CONFIDENCE_LABEL[journey.confidence]}</Badge> : <Badge variant="outline">Unattributed</Badge>}
        </CardTitle>
        {journey.confidence && <CardDescription>{CONFIDENCE_TEXT[journey.confidence]}</CardDescription>}
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TouchBlock title="First touch" touch={journey.first} empty="Not known. Nothing in the record says where this customer came from." />
          <TouchBlock title={same ? "Last touch before funding (same)" : "Last touch before funding"} touch={journey.last} empty="Not known." />
        </div>
        <div className="rounded-md border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Why attributed</p>
          <p className="mt-1 text-sm">{journey.why}</p>
        </div>
        {touches.length > 1 && (
          <ShowFirst
            name="journey-touches"
            title="Every touch"
            noun="touches"
            limit={3}
            items={touches.map((t, i) => (
              <div key={`${t.at}-${t.kind}-${i}`} className="flex items-start justify-between gap-2 rounded-md border border-border p-2 text-sm">
                <span className="min-w-0 break-words">
                  {kindLabel(t.kind)}
                  {t.campaign?.name ? ` · ${t.campaign.name}` : t.code ? ` · ${t.code}` : ""}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatWhen(new Date(t.at))}</span>
              </div>
            ))}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function JourneySteps({ journey, dueAtIso, nowIso }: { journey: Journey; dueAtIso: string; nowIso: string }) {
  return (
    <Card role="region" aria-labelledby="journey-steps" className={cn(motion.enter)} style={{ "--i": 1 } as React.CSSProperties}>
      <CardHeader>
        <CardTitle id="journey-steps" className="text-base">From lead to revenue</CardTitle>
        <CardDescription>Each step with its date, and how long after the lead arrived it happened.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-0">
          {journey.steps.map((s, i) => {
            const Icon = STATE_ICON[s.state];
            const timer = s.key === "first_contact" && s.state === "pending";
            return (
              <li key={s.key} className="relative flex gap-3 pb-3 last:pb-0">
                {i < journey.steps.length - 1 && <span className="absolute left-[11px] top-6 bottom-0 w-px bg-border" aria-hidden="true" />}
                <Icon className={cn("relative mt-0.5 size-6 shrink-0 rounded-full bg-card", STATE_TONE[s.state])} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-sm font-medium">
                      {s.label} <span className="sr-only">: {STATE_WORD[s.state]}</span>
                    </p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {s.at ? formatWhen(s.at) : STATE_WORD[s.state]}
                      {s.sinceLead ? <span className="ml-2 rounded bg-muted px-1.5 py-0.5">+{s.sinceLead}</span> : null}
                    </p>
                  </div>
                  <p className="mt-0.5 break-words text-sm text-muted-foreground">
                    {s.detail}
                    {s.slaMet === false ? <Badge variant="destructive" className="ml-2">Past SLA</Badge> : null}
                    {s.slaMet === true ? <Badge variant="success" className="ml-2">Within SLA</Badge> : null}
                  </p>
                  {timer && <div className="mt-1"><SpeedTimer dueAtIso={dueAtIso} nowIso={nowIso} /></div>}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
