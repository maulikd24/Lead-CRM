import { Fragment } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, HelpCircle, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { motion, PhoneSheet, ShowFirst } from "@/components/workspace";
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
            {touch.form && touch.campaign ? <span className="max-lg:hidden"> · form {touch.form}</span> : null}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground max-lg:hidden">{formatWhen(new Date(touch.at))}</p>
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
    <Card size="sm" role="region" aria-labelledby="journey-origin" className={cn(motion.enter)}>
      <CardHeader>
        <CardTitle id="journey-origin" className="flex flex-wrap items-center gap-2 text-base">
          Where this customer came from
          {journey.confidence ? <Badge variant={journey.confidence === "high" ? "success" : journey.confidence === "medium" ? "warning" : "outline"}>{CONFIDENCE_LABEL[journey.confidence]}</Badge> : <Badge variant="outline">Unattributed</Badge>}
        </CardTitle>
        {journey.confidence && <CardDescription className="max-lg:hidden">{CONFIDENCE_TEXT[journey.confidence]}</CardDescription>}
      </CardHeader>
      <CardContent className="grid gap-4 max-lg:gap-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <TouchBlock title="First touch" touch={journey.first} empty="Not known. Nothing in the record says where this customer came from." />
          {same ? (
            <div className="min-w-0 max-lg:hidden">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last touch before funding</p>
              <p className="mt-1 text-sm text-muted-foreground">Same as the first touch.</p>
            </div>
          ) : (
            <TouchBlock title="Last touch before funding" touch={journey.last} empty="Not known." />
          )}
        </div>
        <div className="rounded-md border border-border bg-muted/40 p-3 max-lg:p-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Why attributed</p>
          <p className="mt-1 text-sm">{journey.why}</p>
        </div>
        {touches.length > 1 && (
          <PhoneSheet name="journey-touches" title="Every touch" summary={`${touches.length} touches, from ${formatWhen(new Date(touches[0].at)).split(",")[0]}`}>
            <ShowFirst
              name="journey-touches-list"
              title="Every touch"
              noun="touches"
              limit={Infinity}
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
          </PhoneSheet>
        )}
      </CardContent>
    </Card>
  );
}

function StepRow({ s, showLine, dueAtIso, nowIso, className }: { s: JourneyStep; showLine: boolean; dueAtIso: string; nowIso: string; className?: string }) {
  const Icon = STATE_ICON[s.state];
  const timer = s.key === "first_contact" && s.state === "pending";
  return (
    <li className={cn("relative flex gap-3 pb-3 last:pb-0 max-lg:pb-2", (s.key === "first_touch" || s.key === "lead_created") && "max-lg:hidden", className)}>
      {showLine && <span className="absolute left-[11px] top-6 bottom-0 w-px bg-border" aria-hidden="true" />}
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
        <p className={cn("mt-0.5 break-words text-sm text-muted-foreground max-lg:text-xs", ["lead_created", "first_touch", "kyc_approved", "first_transaction"].includes(s.key) && "max-lg:hidden")}>
          {s.detail}
          {s.slaMet === false ? <Badge variant="destructive" className="ml-2">Past SLA</Badge> : null}
          {s.slaMet === true ? <Badge variant="success" className="ml-2">Within SLA</Badge> : null}
        </p>
        {timer && <div className="mt-1"><SpeedTimer dueAtIso={dueAtIso} nowIso={nowIso} /></div>}
      </div>
    </li>
  );
}

const isKycStep = (s: JourneyStep) => s.key.startsWith("kyc_") && s.key !== "kyc_approved";

/** On a laptop every step is in the list; on a phone the KYC steps fold into one row so the tab stays short. */
export function JourneySteps({ journey, dueAtIso, nowIso }: { journey: Journey; dueAtIso: string; nowIso: string }) {
  const kyc = journey.steps.filter(isKycStep);
  return (
    <Card size="sm" role="region" aria-labelledby="journey-steps" className={cn(motion.enter)} style={{ "--i": 1 } as React.CSSProperties}>
      <CardHeader>
        <CardTitle id="journey-steps" className="text-base">From lead to revenue</CardTitle>
        <CardDescription className="max-lg:hidden">Each step with its date, and how long after the lead arrived it happened.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-0">
          {journey.steps.map((s, i) => (
            <Fragment key={s.key}>
              {s.key === "kyc_approved" && kyc.length > 0 && (
                <li className="pb-3 lg:hidden">
                  <details className="rounded-md border border-border px-3 py-2">
                    <summary className="cursor-pointer text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">KYC steps ({kyc.filter((k) => k.state === "done").length} of {kyc.length} done)</summary>
                    <ol className="mt-3 grid gap-0">{kyc.map((k) => <StepRow key={k.key} s={k} showLine={false} dueAtIso={dueAtIso} nowIso={nowIso} />)}</ol>
                  </details>
                </li>
              )}
              <StepRow s={s} showLine={i < journey.steps.length - 1} dueAtIso={dueAtIso} nowIso={nowIso} className={isKycStep(s) ? "max-lg:hidden" : undefined} />
            </Fragment>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
