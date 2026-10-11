import Link from "next/link";
import { ArrowRightLeft, BadgeCheck, Bot, ChevronDown, ExternalLink, LifeBuoy, ListChecks, Megaphone, MessageSquare, PenLine, Scale, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { approvalTone, confidenceShort, confidenceText, formatWhen, groupChain, resultTone } from "@/lib/ledger/format";
import { PHASES, PHASE_LABEL, type Actor, type LedgerEntry, type LedgerKind, type SourceLink } from "@/lib/ledger/types";
import { cn } from "@/lib/utils";

const ICON: Record<LedgerKind, React.ComponentType<{ className?: string }>> = {
  message: MessageSquare, draft: PenLine, decision: Scale, task: ListChecks, approval: BadgeCheck, consent: ShieldCheck, service: LifeBuoy, stage: ArrowRightLeft, campaign: Megaphone,
};

function Source({ s }: { s: SourceLink }) {
  return s.href ? (
    <Link href={s.href} className="inline-flex items-center gap-1 rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      {s.label}
      <ExternalLink className="size-3" aria-hidden />
    </Link>
  ) : (
    <span>{s.label}</span>
  );
}

const who = (a: Actor | null) => (a ? a.label : "Not recorded");

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

/**
 * One ledger entry: a collapsed row (what happened, when, and the three things a reader asks first: certain or inferred, AI or not, who approved) that opens
 * to the nine answers and the chain from trigger to follow-on. A native <details>, so it is keyboard operable and needs no script; nothing animates.
 */
export function LedgerEntryCard({ entry, defaultOpen = false, idPrefix }: { entry: LedgerEntry; defaultOpen?: boolean; idPrefix: string }) {
  const Icon = ICON[entry.kind];
  const titleId = `${idPrefix}-t`;
  const groups = groupChain(entry, PHASES);
  const inferred = entry.confidence === "inferred";
  return (
    <article aria-labelledby={titleId} className={cn("rounded-lg border bg-card", inferred ? "border-warning/50" : "border-border")} data-kind={entry.kind} data-confidence={entry.confidence}>
      <details open={defaultOpen} className="group">
        <summary className="flex cursor-pointer list-none items-start gap-3 p-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background" aria-hidden>
            <Icon className="size-4 text-muted-foreground" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h3 id={titleId} className="min-w-0 text-sm font-medium break-words">{entry.action.label}</h3>
              <time className="shrink-0 text-xs tabular-nums text-muted-foreground" dateTime={entry.at}>{formatWhen(entry.at)}</time>
            </span>
            <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant={inferred ? "warning" : "outline"}>{confidenceShort(entry.confidence)}</Badge>
              {entry.ai ? (
                <Badge variant="secondary" className="gap-1"><Bot className="size-3" aria-hidden />{entry.ai.agentKey}{entry.ai.levelLabel ? `, ${entry.ai.levelLabel.split(" ")[0]}` : ""}</Badge>
              ) : (
                <Badge variant="outline">No AI</Badge>
              )}
              <Badge variant={approvalTone(entry.approval.state)}>{entry.approval.state === "not_required" ? "No approval needed" : entry.approval.label}</Badge>
              {entry.result && <Badge variant={resultTone(entry.result.tone)}>{entry.result.label}</Badge>}
            </span>
          </span>
          <ChevronDown className="mt-1.5 size-4 shrink-0 text-muted-foreground group-open:rotate-180" aria-hidden />
        </summary>

        <div className="grid gap-4 border-t border-border p-3">
          {inferred && (
            <p role="note" className="rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs">
              <strong className="font-medium">Inferred link.</strong> {confidenceText(entry.confidence, entry.score)}. {entry.inferredLinks.filter((l) => l.role === "trigger").map((l) => l.because).join(" ")}
            </p>
          )}
          <dl className="grid gap-2.5">
            <Row label="Action"><Source s={entry.action.subject} /></Row>
            <Row label="Trigger">{entry.trigger ? <>{entry.trigger.label}{entry.trigger.source && <> (<Source s={entry.trigger.source} />)</>}</> : "Not recorded"}</Row>
            <Row label="Decision">
              {entry.decision ? (
                <span className="grid gap-0.5">
                  <span>{entry.decision.engineVersion}: {entry.decision.result.toLowerCase().replace("_", " ")} for {entry.decision.programme.replace(/_/g, " ")}{entry.decision.abstainReason ? ` (${entry.decision.abstainReason.replace(/_/g, " ")})` : ""}</span>
                  {entry.decision.suppressions.map((s) => <span key={`${s.rule}-${s.because}`} className="text-xs text-muted-foreground">Held back by {s.rule.replace(/_/g, " ")} ({s.effect}): {s.because}</span>)}
                  {entry.decision.consent && <span className="text-xs text-muted-foreground">{entry.decision.consent}</span>}
                  <span className="text-xs"><Source s={entry.decision.source} /></span>
                </span>
              ) : (
                "No engine decision tied to this action"
              )}
            </Row>
            <Row label="Evidence">
              {entry.evidence.length ? (
                <ul className="grid gap-0.5">
                  {entry.evidence.map((e) => <li key={`${e.table}:${e.id}`} className="text-xs"><span className="text-muted-foreground">{e.kind}{e.confirmation && e.confirmation !== "not_applicable" ? `, ${e.confirmation.replace(/_/g, " ")}` : ""}:</span> {e.label}</li>)}
                </ul>
              ) : (
                "None recorded"
              )}
            </Row>
            <Row label="Initiated by">{who(entry.initiatedBy)}</Row>
            <Row label="Executed by">{who(entry.executedBy)}</Row>
            <Row label="AI involvement">
              {entry.ai ? (
                <span className="grid gap-0.5">
                  <span>{entry.ai.agentKey}{entry.ai.registered ? ` (version ${entry.ai.agentVersion})` : " (not in the agent registry)"}{entry.ai.levelLabel ? `, ${entry.ai.levelLabel}` : ""}</span>
                  {entry.ai.actionLabel && <span className="text-xs text-muted-foreground">{entry.ai.actionLabel}</span>}
                  {entry.ai.approvalPolicy && <span className="text-xs text-muted-foreground">Approval policy: {entry.ai.approvalPolicy}</span>}
                  {entry.ai.runs && <span className="text-xs text-muted-foreground">{entry.ai.runs.count} model run{entry.ai.runs.count === 1 ? "" : "s"}{entry.ai.runs.costUsdEstimate ? `, about $${entry.ai.runs.costUsdEstimate.toFixed(4)} (an estimate)` : ""}{entry.ai.runs.confidence === "inferred" ? ". Matched by customer and time, not by an id: inferred." : "."}</span>}
                </span>
              ) : (
                "None: no AI agent took part"
              )}
            </Row>
            <Row label="Approved by">{entry.approval.label}{entry.approval.at ? ` (${formatWhen(entry.approval.at)})` : ""}{entry.approval.source && <> (<Source s={entry.approval.source} />)</>}</Row>
            <Row label="Result">{entry.result ? `${entry.result.label}${entry.result.at ? ` (${formatWhen(entry.result.at)})` : ""}` : "Not recorded"}</Row>
            <Row label="Follow-on">
              {entry.followOn.length ? (
                <ul className="grid gap-1">
                  {entry.followOn.map((s) => (
                    <li key={s.id} className="text-xs">
                      {s.title} <span className="text-muted-foreground">({formatWhen(s.at)})</span>
                      {s.confidence === "inferred" && <Badge variant="warning" className="ml-1.5">Inferred</Badge>}
                      {s.inferredBecause && <span className="block text-muted-foreground">{s.inferredBecause}</span>}
                      {s.detail && <span className="block text-muted-foreground">{s.detail}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                "Nothing yet"
              )}
            </Row>
          </dl>

          <section aria-label="Chain" className="grid gap-2">
            <p className="font-heading text-xs font-medium tracking-wide text-muted-foreground uppercase">Chain: trigger to follow-on</p>
            <ol className="relative grid gap-3 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-border">
              {groups.map((g) => (
                <li key={g.phase} className="relative pl-5">
                  <span className="absolute top-1.5 left-0 size-[11px] rounded-full border border-border bg-card" aria-hidden />
                  <p className="text-xs font-medium">{PHASE_LABEL[g.phase]}</p>
                  <ul className="mt-1 grid gap-1.5">
                    {g.steps.map((s) => (
                      <li key={s.id} className="text-xs">
                        <span className="break-words">{s.title}</span> <span className="tabular-nums text-muted-foreground">{formatWhen(s.at)}</span>
                        {s.confidence === "inferred" && <Badge variant="warning" className="ml-1.5" title={s.inferredBecause}>Inferred {s.score.toFixed(1)}</Badge>}
                        {s.detail && <span className="block text-muted-foreground">{s.detail}</span>}
                        {s.inferredBecause && <span className="block text-muted-foreground">{s.inferredBecause}</span>}
                        <span className="block text-muted-foreground">Source: <Source s={s.source} /></span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </section>

          <section aria-label="Source records" className="grid gap-1">
            <p className="font-heading text-xs font-medium tracking-wide text-muted-foreground uppercase">Source records</p>
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {entry.sources.map((s) => <li key={`${s.table}:${s.id}`}><Source s={s} /></li>)}
            </ul>
            {entry.correlationIds.length > 0 && <p className="text-xs break-all text-muted-foreground">Correlation: {entry.correlationIds.join(", ")}</p>}
          </section>
        </div>
      </details>
    </article>
  );
}
