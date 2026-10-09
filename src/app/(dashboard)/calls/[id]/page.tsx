import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Quote } from "lucide-react";

import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CallMedia } from "@/components/calls/call-media";
import { FlagChips } from "@/components/calls/flag-chips";
import { QualityRing } from "@/components/calls/quality-ring";
import { ReviewPanel } from "@/components/calls/review-panel";
import { callsReviewEnabled } from "@/lib/calls/flag";
import { loadCallDetail } from "@/lib/calls/queries";
import { FLAG_LABEL, OUTCOME_LABEL } from "@/lib/calls/view-model";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import "@/components/calls/calls.css";

const ANALYSIS_NOTE = {
  none: "This call has no transcript or analysis. Calls without a recording at the provider are not analysed.",
  pending: "Waiting for the transcript from the telephony provider.",
  analyzing: "The call is being analysed.",
  failed: "The analysis did not complete.",
  done: null,
} as const;

const SENTIMENT_VARIANT = { positive: "success", neutral: "outline", mixed: "warning", negative: "destructive" } as const;

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!callsReviewEnabled()) notFound();
  const session = await requireRole(["ADMIN", "MANAGER", "RM"]);
  const { id } = await params;
  const scope = await getVisibleUserIds(session.user.id, session.user.role);
  const call = await loadCallDetail(id, scope, new Date());
  if (!call) notFound(); // missing and not-yours look the same
  const isManager = session.user.role === "ADMIN" || session.user.role === "MANAGER";

  return (
    <div className="flex flex-col gap-6">
      <Link href="/calls" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        All calls
      </Link>
      <PageHeader
        title={`Call with ${call.customerName}`}
        description={`${formatDateTime(call.occurredAt)} · ${call.outcome ? OUTCOME_LABEL[call.outcome] : "Call"}${call.outcome === "connected" ? ` · ${call.durationLabel}` : ""}${call.rmName ? ` · ${call.rmName}` : ""}`}
        actions={
          <Link href={`/clients/${call.clientId}`} className="text-sm text-primary underline-offset-2 hover:underline">
            View customer
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <CallMedia callId={call.id} hasRecording={call.hasRecording} turns={call.turns} analysisNote={call.analysis === "done" ? null : (call.failureReason ? `${ANALYSIS_NOTE.failed} ${call.failureReason}` : ANALYSIS_NOTE[call.analysis])} />
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-5 pt-1">
              <QualityRing score={call.score} size="lg" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="text-xs text-muted-foreground">Quality score</p>
                {call.sentiment && <Badge variant={SENTIMENT_VARIANT[call.sentiment as keyof typeof SENTIMENT_VARIANT] ?? "outline"} className="w-fit">{call.sentiment} sentiment</Badge>}
                {call.aiScore !== null && call.score !== call.aiScore && <p className="text-xs text-muted-foreground">AI scored {call.aiScore}; a manager adjusted it.</p>}
                {call.score === null && <p className="text-sm text-muted-foreground">{call.analysis === "done" ? "No score recorded." : (ANALYSIS_NOTE[call.analysis] ?? "")}</p>}
                <FlagChips flags={call.flags} />
              </div>
            </CardContent>
          </Card>

          {call.summary && (
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <p>{call.summary}</p>
                {call.recommendation && (
                  <p className="border-t border-border pt-3 text-muted-foreground">
                    <span className="font-medium text-foreground">Suggested next step: </span>
                    {call.recommendation}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Written by AI from the transcript. Check it against the recording.</p>
              </CardContent>
            </Card>
          )}

          {call.rubric.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>How it scored</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-4">
                  {call.rubric.map((row, i) => {
                    const pct = row.maxScore > 0 ? (row.score / row.maxScore) * 100 : 0;
                    return (
                      <li key={row.key} className="flex flex-col gap-1.5">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="font-medium">{row.label}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {row.score} / {row.maxScore}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
                          <div className={cn("calls-bar h-full rounded-full", pct < 50 ? "bg-destructive" : pct < 75 ? "bg-warning" : "bg-success")} style={{ width: `${pct}%`, "--i": i } as React.CSSProperties} />
                        </div>
                        {row.notes && <p className="text-xs text-muted-foreground">{row.notes}</p>}
                        {row.evidence.map((quote) => (
                          <blockquote key={quote} className="flex gap-2 border-l-2 border-primary/60 pl-3 text-xs italic text-muted-foreground">
                            <Quote className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                            {quote}
                          </blockquote>
                        ))}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}

          {(call.commitments.length > 0 || call.objections.length > 0 || call.flagDetails.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>What came up</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-5 text-sm">
                {call.flagDetails.length > 0 && (
                  <section aria-label="Concerns">
                    <h3 className="mb-2 text-xs font-medium text-muted-foreground">Concerns</h3>
                    <ul className="flex flex-col gap-2">
                      {call.flagDetails.map((f, i) => (
                        <li key={i} className="flex flex-col gap-0.5">
                          <span className="font-medium">{FLAG_LABEL[f.kind]}{f.severity ? ` (${f.severity})` : ""}</span>
                          <span className="text-muted-foreground">{f.text}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {call.commitments.length > 0 && (
                  <section aria-label="Commitments">
                    <h3 className="mb-2 text-xs font-medium text-muted-foreground">Promises made</h3>
                    <ul className="flex flex-col gap-2">
                      {call.commitments.map((c) => (
                        <li key={c.id} className="flex items-start justify-between gap-3">
                          <span>{c.text}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{c.status === "DONE" ? "Done" : c.dueAt ? `Due ${formatDate(c.dueAt)}` : "Open"}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {call.objections.length > 0 && (
                  <section aria-label="Objections">
                    <h3 className="mb-2 text-xs font-medium text-muted-foreground">Objections raised</h3>
                    <ul className="flex flex-col gap-2">
                      {call.objections.map((o) => (
                        <li key={o.id}>{o.text}</li>
                      ))}
                    </ul>
                  </section>
                )}
              </CardContent>
            </Card>
          )}

          <ReviewPanel
            activityId={call.id}
            defaultTaskTitle={call.recommendation ?? `Follow up with ${call.customerName} after call`}
            task={call.task ? { title: call.task.title, status: call.task.status, dueAtIso: call.task.dueAt.toISOString() } : null}
            canMarkReviewed={isManager}
            canReviewNow={call.analysis === "done"}
            reviewedAtIso={call.reviewedAt ? call.reviewedAt.toISOString() : null}
            reviewedByName={call.reviewedByName}
            reviewNotes={call.reviewNotes}
          />
        </div>
      </div>
    </div>
  );
}
