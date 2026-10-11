import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { motion } from "@/components/workspace";
import { ABSTAIN_LABEL } from "@/lib/intelligence/decision/view";
import type { CriterionResult } from "@/lib/intelligence/decision/exit-criteria";
import { CORRELATION_NOTE } from "@/lib/intelligence/decision/outcome-linking";
import type { ReplayReport } from "@/lib/intelligence/decision/replay";
import type { ShadowReport } from "@/lib/intelligence/decision/shadow-stats-db";
import { feedbackLabel } from "@/components/decision/labels";
import { ReplayButton } from "./replay-button";

const STATUS = {
  pass: { icon: CheckCircle2, word: "Pass", cls: "text-success" },
  fail: { icon: AlertTriangle, word: "Fail", cls: "text-destructive" },
  insufficient_data: { icon: CircleDashed, word: "Waiting for data", cls: "text-muted-foreground" },
} as const;

/** State is an icon AND a word, never colour alone. */
export function StatusWord({ status }: { status: CriterionResult["status"] }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium ${s.cls}`}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {s.word}
    </span>
  );
}

export function CriteriaView({ report }: { report: ShadowReport }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{report.exit.summary}</p>
      <ul className="flex flex-col gap-2">
        {report.exit.criteria.map((c, i) => (
          <li key={c.id} className={motion.enter} style={{ ["--i" as string]: i }}>
            <Card size="sm" className="gap-0 py-2">
              <CardContent className="flex flex-col gap-1 px-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{c.title}</p>
                  <StatusWord status={c.status} />
                </div>
                <p className="text-sm">{c.measured}</p>
                <p className="text-xs text-muted-foreground">Needs: {c.threshold}</p>
                <p className="text-xs text-muted-foreground">{c.detail}</p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      {report.consentMismatches.length > 0 && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
          {report.consentMismatches.length} decision{report.consentMismatches.length === 1 ? "" : "s"} recommended a channel the consent ledger forbids at the time. First: {report.consentMismatches[0].decisionId} ({report.consentMismatches[0].channel}).
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Window: last {report.windowDays} days. Gate run recorded: {report.gateRecordedAt ? new Date(report.gateRecordedAt).toLocaleString("en-IN") : "none (run `npm run decision:report -- --run-gates`)"}. Leaving shadow is a decision for a person; this page only reports the evidence.
      </p>
    </div>
  );
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${Math.round((1000 * n) / d) / 10}%`);

export function ReplayView({ run }: { run: { id: string; createdAt: Date; summary: ReplayReport } | null }) {
  return (
    <div className="flex flex-col gap-4">
      <ReplayButton />
      {!run ? (
        <p className="text-sm text-muted-foreground">No replay has been run yet. Run one here, or with `npm run decision:replay`.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Last run {run.createdAt.toLocaleString("en-IN")}: {run.summary.evaluated} snapshots evaluated, {run.summary.skipped} skipped.</p>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Agreement with current engine", `${run.summary.agreement.ratePct}%`],
              ["Recommendations", String(run.summary.results.RECOMMEND ?? 0)],
              ["No action", String(run.summary.results.NO_ACTION ?? 0)],
              ["Abstained", String(run.summary.results.ABSTAIN ?? 0)],
              ["Candidates blocked", `${run.summary.suppression.blockedCandidates} of ${run.summary.suppression.candidates}`],
              ["Material regressions", String(run.summary.materialRegressions.length)],
              ["Channel switched by policy", String(run.summary.channelFallbacks)],
              ["Contact within 7 days after a recommendation", pct(run.summary.outcomes.byResult.RECOMMEND?.followedByContact ?? 0, run.summary.outcomes.byResult.RECOMMEND?.decisions ?? 0)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-md border border-border p-2">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="font-heading text-lg font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {Object.keys(run.summary.suppression.byRule).length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold">Suppression by rule</h3>
              <ul className="flex flex-wrap gap-1.5">
                {Object.entries(run.summary.suppression.byRule).map(([k, v]) => (
                  <li key={k}><Badge variant="outline">{k.replace(/_/g, " ")}: {v}</Badge></li>
                ))}
              </ul>
            </div>
          )}
          {run.summary.materialRegressions.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold">Material regressions to investigate</h3>
              <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                {run.summary.materialRegressions.slice(0, 8).map((m, i) => (
                  <li key={i}>{m.clientId} on {m.asOf.slice(0, 10)}: {m.summary}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <p>{CORRELATION_NOTE}</p>
            {run.summary.limits.map((l) => (
              <p key={l}>Limit: {l}</p>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function DifferencesView({ summary, report }: { summary: { byKind: Record<string, number>; bySeverity: Record<string, number>; total: number }; report: ShadowReport }) {
  const KIND: Record<string, string> = { action_differs: "Same programme, different action or channel", programme_differs: "Different programme", v2_holds_back: "New engine holds back where the current one acts", v2_abstains: "New engine abstains", suppression_regression: "Recommends something the current engine said not to raise" };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{summary.total} stored decision{summary.total === 1 ? "" : "s"} differ from the current engine in the last {report.windowDays} days. Only a material difference (the new engine is less careful) counts against the exit criteria.</p>
      <ul className="flex flex-col gap-1.5">
        {Object.entries(summary.byKind).map(([k, v]) => (
          <li key={k} className="flex items-baseline justify-between gap-3 rounded-md border border-border px-3 py-1.5 text-sm">
            <span>{KIND[k] ?? k}</span>
            <span className="tabular-nums font-medium">{v}</span>
          </li>
        ))}
        {Object.keys(summary.byKind).length === 0 && <li className="text-sm text-muted-foreground">No differences recorded.</li>}
      </ul>
      <h3 className="text-sm font-semibold">Results and abstentions</h3>
      <ul className="flex flex-wrap gap-1.5">
        {Object.entries(report.byResult).map(([k, v]) => (
          <li key={k}><Badge variant="outline">{k.replace(/_/g, " ").toLowerCase()}: {v}</Badge></li>
        ))}
        {Object.entries(report.abstainReasons).map(([k, v]) => (
          <li key={k}><Badge variant="warning">{ABSTAIN_LABEL[k] ?? k}: {v}</Badge></li>
        ))}
      </ul>
    </div>
  );
}

export function FeedbackView({ report }: { report: ShadowReport }) {
  const r = report.rates;
  const row = (label: string, g: { decisions: number; followedByContact: number; followedByResponse: number }) => (
    <tr className="border-t border-border">
      <th scope="row" className="py-1.5 pr-2 text-left font-normal">{label}</th>
      <td className="py-1.5 text-right tabular-nums">{g.decisions}</td>
      <td className="py-1.5 text-right tabular-nums">{pct(g.followedByContact, g.decisions)}</td>
      <td className="py-1.5 text-right tabular-nums">{pct(g.followedByResponse, g.decisions)}</td>
    </tr>
  );
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="mb-1 text-sm font-semibold">Feedback received (reviewers)</h3>
        <ul className="flex flex-wrap gap-1.5">
          {Object.entries(report.feedbackKinds).map(([k, v]) => (
            <li key={k}><Badge variant="outline">{feedbackLabel(k)}: {v}</Badge></li>
          ))}
          {Object.keys(report.feedbackKinds).length === 0 && <li className="text-sm text-muted-foreground">No feedback yet.</li>}
        </ul>
      </div>
      <div>
        <h3 className="mb-1 text-sm font-semibold">What followed a recommendation</h3>
        <table className="w-full text-sm">
          <caption className="sr-only">Contact and reply rates after accepted or ignored recommendations</caption>
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="py-1 font-medium">Group</th>
              <th scope="col" className="py-1 text-right font-medium">Decisions</th>
              <th scope="col" className="py-1 text-right font-medium">Contact followed</th>
              <th scope="col" className="py-1 text-right font-medium">Customer replied</th>
            </tr>
          </thead>
          <tbody>
            {row("After accept or done", r.afterAccept)}
            {row("Ignored or expired", r.afterIgnored)}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">{r.note}</p>
      </div>
    </div>
  );
}
