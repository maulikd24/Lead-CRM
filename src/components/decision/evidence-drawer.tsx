"use client";

import { type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { ABSTAIN_LABEL, RESULT_LABEL, SUPPRESSION_LABEL, type DecisionView } from "@/lib/intelligence/decision/view";
import { actionHeadline, ageText, channelLabel, confidenceLabel, CONFIDENCE_NOTE, confirmationLabel, effectLabel, feedbackLabel, OUTCOME_LABEL, policyLines, SCORE_NOTE, shortDate } from "./labels";
import { FeedbackBar } from "./feedback-bar";

const CONFIRM_VARIANT = { confirmed: "success", ai_inferred: "warning", not_applicable: "outline" } as const;
const SALES = new Set(["Demat portfolio transfer", "Mutual fund portfolio transfer", "Portfolio rebalance", "MF / SIP opportunity", "PMS / AIF opportunity", "Broking activation / reactivation", "Tax-planning discussion", "First transaction"]);

function Section({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="font-heading text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * "Why this action": the content of the Evidence Drawer. Inputs with weights (labelled heuristic), evidence with source, freshness and
 * confirmation state, what was suppressed and the runner-ups, the policy result, outcomes next to the decision (correlation, not
 * causation) and the footer. No PAN and no raw conversation text: evidence lines are summaries.
 */
export function EvidenceDrawerBody({ view, now }: { view: DecisionView; now: Date }) {
  const rec = view.result === "RECOMMEND";
  return (
    <div className="flex flex-col gap-5 text-sm">
      <header className="flex flex-col gap-2">
        <p className="font-heading text-base font-semibold">{actionHeadline(view)}</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={rec ? "accent" : "outline"}>{RESULT_LABEL[view.result]}</Badge>
          {view.abstainReason && <Badge variant="warning">{ABSTAIN_LABEL[view.abstainReason] ?? view.abstainReason}</Badge>}
          {rec && <Badge variant="outline">{channelLabel(view.channel)}</Badge>}
          {rec && <Badge variant="outline">Owner: {view.owner}</Badge>}
          {rec && <Badge variant="outline">When: {view.timing}{view.notBefore ? ` (not before ${shortDate(view.notBefore)})` : ""}</Badge>}
          {rec && <Badge variant={view.priority === "High" ? "destructive" : view.priority === "Medium" ? "warning" : "outline"}>{view.priority} priority</Badge>}
          <Badge variant="outline">Status: {view.status.toLowerCase()}</Badge>
        </div>
        <p className="text-muted-foreground">{view.reason}</p>
        {view.escalation === "manager_review" && <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">Routed to a manager for review. No AI draft is produced for this customer.</p>}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-muted-foreground">{CONFIDENCE_NOTE}</dt>
          <dd className="font-medium">{confidenceLabel(view.confidence)}</dd>
          {rec && (
            <>
              <dt className="text-muted-foreground">{SCORE_NOTE}</dt>
              <dd className="font-medium tabular-nums">{view.priorityScore} of 100</dd>
            </>
          )}
        </dl>
      </header>

      <Section title="Why this action" id="dec-why">
        {view.evidence.length === 0 ? (
          <p className="text-muted-foreground">No supporting evidence was recorded.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {view.evidence.map((e, i) => (
              <li key={`${e.ref}-${i}`} className="rounded-md border border-border p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={CONFIRM_VARIANT[e.confirmation]}>{confirmationLabel(e.confirmation)}</Badge>
                  <span className="text-xs text-muted-foreground">{e.kind}</span>
                </div>
                <p className="mt-1">{e.text}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Source {e.ref}
                  {e.observedAt ? ` · observed ${shortDate(e.observedAt)} (${ageText(e.observedAt, now)})` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {view.scoreInputs.length > 0 && (
        <Section title="How the score was built (heuristic weights, set by judgement)" id="dec-score">
          <table className="w-full text-xs">
            <caption className="sr-only">Score inputs and their points</caption>
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="py-1 font-medium">Input</th>
                <th scope="col" className="py-1 text-right font-medium">Points</th>
              </tr>
            </thead>
            <tbody>
              {view.scoreInputs.map((s, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1 pr-2">{s.label}</td>
                  <td className="py-1 text-right tabular-nums">{s.points > 0 && s.kind !== "base" ? `+${s.points}` : s.points}</td>
                </tr>
              ))}
              <tr className="border-t border-border font-medium">
                <td className="py-1 pr-2">Total, capped at 100</td>
                <td className="py-1 text-right tabular-nums">{view.priorityScore}</td>
              </tr>
            </tbody>
          </table>
        </Section>
      )}

      <Section title="What I did not recommend" id="dec-not">
        {view.suppression.length === 0 && view.alternatives.length === 0 ? (
          <p className="text-muted-foreground">Nothing else was considered or held back.</p>
        ) : (
          <>
            {view.alternatives.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {view.alternatives.map((a) => (
                  <li key={a.candidateId} className="rounded-md border border-border p-2">
                    <p className="font-medium">{a.action}: {a.topic ?? a.programme}</p>
                    <p className="text-xs text-muted-foreground">{a.blockedBy ? `Not recommended: ${a.blockedBy}` : "Runner-up: allowed, but ranked lower"}</p>
                  </li>
                ))}
              </ul>
            )}
            {view.suppression.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs">
                {view.suppression.slice(0, 12).map((s, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-1.5">
                    <Badge variant={s.effect === "block" ? "destructive" : "warning"}>{effectLabel(s.effect)}</Badge>
                    <span className="font-medium">{SUPPRESSION_LABEL[s.rule] ?? s.rule}</span>
                    <span className="text-muted-foreground">{s.because}</span>
                  </li>
                ))}
                {view.suppression.length > 12 && <li className="text-muted-foreground">and {view.suppression.length - 12} more</li>}
              </ul>
            )}
          </>
        )}
      </Section>

      <Section title="Policy" id="dec-policy">
        <ul className="flex flex-col gap-1">
          {policyLines(view.policyResult).map((l) => (
            <li key={l.label} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-muted-foreground">{l.label}</span>
              <span className={l.ok ? "text-right" : "text-right font-medium text-destructive"}>{l.value}</span>
            </li>
          ))}
        </ul>
      </Section>

      {(view.outcomes.length > 0 || view.feedback.length > 0) && (
        <Section title="What happened next" id="dec-next">
          {view.feedback.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs">
              {view.feedback.map((f, i) => (
                <li key={i}>
                  {feedbackLabel(f.kind)}
                  {f.reason ? ` (${f.reason.replace(/_/g, " ")})` : ""} · {shortDate(f.at)}
                </li>
              ))}
            </ul>
          )}
          {view.outcomes.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs">
              {view.outcomes.map((o, i) => (
                <li key={i}>
                  {OUTCOME_LABEL[o.kind] ?? o.kind} {o.daysAfter === 0 ? "the same day" : `${o.daysAfter} day${o.daysAfter === 1 ? "" : "s"} after`}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">{view.correlationNote}</p>
        </Section>
      )}

      {view.disagreement && (
        <Section title="Compared with the current engine" id="dec-diff">
          <p className="text-xs text-muted-foreground">
            {view.disagreement.summary}
            {view.disagreement.severity === "material" ? " This is a material difference." : ""}
          </p>
        </Section>
      )}

      <footer className="border-t border-border pt-3 text-xs text-muted-foreground">
        Engine {view.engineVersion} ({view.mode.toLowerCase()} mode) · computed {shortDate(view.createdAt)} · data as of {shortDate(view.observedAt)} · correlation {view.correlationId}. Every feedback action is written to the audit log.
      </footer>
    </div>
  );
}

export function EvidenceDrawerActions({ view, canAct }: { view: DecisionView; canAct: boolean }) {
  if (!canAct) return <p className="text-xs text-muted-foreground">This decision is {view.status.toLowerCase()}; feedback is closed.</p>;
  return <FeedbackBar decisionId={view.id} isRecommendation={view.result === "RECOMMEND"} productTopic={view.assetClass !== null || SALES.has(view.programme)} />;
}
