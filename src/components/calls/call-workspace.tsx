"use client";

import Link from "next/link";
import { ArrowLeft, Quote } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { CountUp, motion, RailCard, RailFact, StickyRail, useUrlTab, WorkspacePanel, WorkspaceShell, WorkspaceTabs } from "@/components/workspace";
import { CALL_DETAIL_TAB_KEYS, callDetailTabs } from "@/lib/calls/tabs";
import type { CallDetail } from "@/lib/calls/detail";
import { FLAG_LABEL, OUTCOME_LABEL } from "@/lib/calls/view-model";
import { formatClock } from "@/lib/calls/transcript";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import "./calls.css";
import { RecordingPlayer, TranscriptBody, useCallAudio, type CallAudio } from "./call-media";
import { FlagChips } from "./flag-chips";
import { QualityRing } from "./quality-ring";
import { ReviewPanel } from "./review-panel";

const ANALYSIS_NOTE = {
  none: "This call has no transcript or analysis. Calls without a recording at the provider are not analysed.",
  pending: "Waiting for the transcript from the telephony provider.",
  analyzing: "The call is being analysed.",
  failed: "The analysis did not complete.",
  done: null,
} as const;

const SENTIMENT_VARIANT = { positive: "success", neutral: "outline", mixed: "warning", negative: "destructive" } as const;
const BAND_TONE = { low: "destructive", mid: "warning", high: "success" } as const;
const stagger = (i: number) => ({ ["--i" as string]: Math.min(i, 12) }) as React.CSSProperties;

function analysisNote(call: CallDetail): string | null {
  return call.analysis === "done" ? null : call.failureReason ? `${ANALYSIS_NOTE.failed} ${call.failureReason}` : ANALYSIS_NOTE[call.analysis];
}

function reviewLabel(call: CallDetail): { value: string; hint: string | null } {
  if (call.reviewedAt) return { value: "Reviewed", hint: call.reviewedByName ? `by ${call.reviewedByName}` : formatDate(call.reviewedAt) };
  if (call.analysis !== "done") return { value: "Awaiting analysis", hint: null };
  return { value: "Not reviewed", hint: null };
}

function ScoresSection({ call }: { call: CallDetail }) {
  return (
    <>
      <Card className={motion.enter}>
        <CardContent className="flex flex-wrap items-center gap-5 pt-1">
          <QualityRing score={call.score} size="lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-xs text-muted-foreground">Quality score</p>
            {call.sentiment && (
              <Badge variant={SENTIMENT_VARIANT[call.sentiment as keyof typeof SENTIMENT_VARIANT] ?? "outline"} className="w-fit">
                {call.sentiment} sentiment
              </Badge>
            )}
            {call.aiScore !== null && call.score !== call.aiScore && <p className="text-xs text-muted-foreground">AI scored {call.aiScore}; a manager adjusted it.</p>}
            {call.score === null && <p className="text-sm text-muted-foreground">{call.analysis === "done" ? "No score recorded." : (ANALYSIS_NOTE[call.analysis] ?? "")}</p>}
            <FlagChips flags={call.flags} />
          </div>
        </CardContent>
      </Card>

      {call.summary && (
        <Card className={motion.enter} style={stagger(1)}>
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
        <Card className={motion.enter} style={stagger(2)}>
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
                      <div className={cn("calls-bar h-full rounded-full", pct < 50 ? "bg-destructive" : pct < 75 ? "bg-warning" : "bg-success")} style={{ width: `${pct}%`, ...stagger(i) }} />
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
    </>
  );
}

function ActionsSection({ call, isManager }: { call: CallDetail; isManager: boolean }) {
  const cameUp = call.commitments.length > 0 || call.objections.length > 0 || call.flagDetails.length > 0;
  return (
    <>
      {cameUp && (
        <Card className={motion.enter}>
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
                      <span className="font-medium">
                        {FLAG_LABEL[f.kind]}
                        {f.severity ? ` (${f.severity})` : ""}
                      </span>
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

      <div className={motion.enter} style={stagger(1)}>
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
    </>
  );
}

/** The recording as a tab: where playback is, and a jump-to list of the timestamped lines. The player itself stays in the header, so it keeps playing while you read the other tabs. */
function RecordingSection({ call, audio }: { call: CallDetail; audio: CallAudio }) {
  const stamped = call.turns.filter((t) => t.startSec !== null);
  const current = audio.activeIndex >= 0 ? call.turns[audio.activeIndex] : null;
  return (
    <Card className={motion.enter}>
      <CardHeader>
        <CardTitle>Recording</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {!call.hasRecording || audio.audioError ? (
          <p className="text-muted-foreground">{audio.audioError ? "The recording could not be loaded. It may have expired at the provider." : "No recording is stored for this call."}</p>
        ) : (
          <p className="text-muted-foreground">
            The player is pinned at the top of the page, so playback carries on while you read the transcript, the scores or the actions. Space plays or pauses and the arrow keys skip; nothing plays until you press play. {current ? <>Now at <span className="tabular-nums">{formatClock(audio.now)}</span>: &ldquo;{current.text}&rdquo;</> : "Press play to follow along here."}
          </p>
        )}
        {stamped.length > 0 && (
          <section aria-label="Jump to">
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">Jump to</h3>
            <ul className="flex flex-col divide-y divide-border/60 rounded-lg border border-border">
              {stamped.map((t) => (
                <li key={t.index} aria-current={t.index === audio.activeIndex ? "true" : undefined} className={cn("flex items-baseline gap-3 px-3 py-2", t.index === audio.activeIndex && "bg-primary/10")}>
                  {audio.canSeek ? (
                    <button type="button" onClick={() => audio.seek(t.startSec as number)} className="rounded px-1 tabular-nums text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60" aria-label={`Play from ${formatClock(t.startSec as number)}`}>
                      {formatClock(t.startSec as number)}
                    </button>
                  ) : (
                    <span className="px-1 tabular-nums text-muted-foreground">{formatClock(t.startSec as number)}</span>
                  )}
                  <span className="min-w-0 truncate">
                    <span className="text-xs text-muted-foreground">{t.speaker === "rm" ? "RM" : t.speaker === "customer" ? "Customer" : t.label || "Speaker"}: </span>
                    {t.text}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}

/** One call as a tabbed workspace: Transcript, Scores, Actions, Recording. The audio element lives in the header so it never remounts when the tab changes. */
export function CallWorkspace({ call, isManager }: { call: CallDetail; isManager: boolean }) {
  const { tab, select, hrefFor } = useUrlTab(CALL_DETAIL_TAB_KEYS, "transcript");
  const { audio, audioRef } = useCallAudio(call.turns, call.hasRecording);
  const tabs = callDetailTabs({ flagDetails: call.flagDetails.length, commitments: call.commitments.length, objections: call.objections.length });
  const review = reviewLabel(call);

  const header = (
    <>
      <Link href="/calls" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        All calls
      </Link>
      <PageHeader
        title={`Call with ${call.customerName}`}
        description={`${formatDateTime(call.occurredAt)} · ${call.outcome ? OUTCOME_LABEL[call.outcome] : "Call"}${call.outcome === "connected" ? ` · ${call.durationLabel}` : ""}${call.rmName ? ` · ${call.rmName}` : ""}`}
        actions={
          <>
            {call.hasRecording && !audio.audioError && <RecordingPlayer callId={call.id} hasRecording audio={audio} audioRef={audioRef} hint={false} className="w-[min(24rem,calc(100vw-3rem))]" />}
            <Link href={`/clients/${call.clientId}`} className="text-sm text-primary underline-offset-2 hover:underline">
              View customer
            </Link>
          </>
        }
      />
    </>
  );

  const rail = (
    <StickyRail
      label="Call facts and review status"
      facts={
        <>
          <RailFact label="Quality score" tone={call.band ? BAND_TONE[call.band] : "default"} hint={call.sentiment ? `${call.sentiment} sentiment` : undefined} index={0}>
            <CountUp value={call.score} />
          </RailFact>
          <RailFact label="Outcome" hint={call.outcome === "connected" ? call.durationLabel : undefined} index={1}>
            {call.outcome ? OUTCOME_LABEL[call.outcome] : "Call"}
          </RailFact>
          <RailFact label="Review" tone={call.reviewedAt ? "success" : "default"} hint={review.hint} index={2}>
            {review.value}
          </RailFact>
          <RailFact label="Flags" tone={call.flags.length > 0 ? "warning" : "default"} index={3}>
            <CountUp value={call.flags.length} />
          </RailFact>
        </>
      }
    >
      <RailCard title="Review status" labelId="call-rail-review" index={4}>
        <div className="flex flex-col gap-2 text-sm">
          {call.reviewedAt ? (
            <>
              <p>
                Reviewed{call.reviewedByName ? ` by ${call.reviewedByName}` : ""} on {formatDateTime(call.reviewedAt)}
              </p>
              {call.reviewNotes && <p className="text-muted-foreground">{call.reviewNotes}</p>}
            </>
          ) : (
            <p className="text-muted-foreground">{call.analysis === "done" ? "A manager has not reviewed this call yet." : (ANALYSIS_NOTE[call.analysis] ?? "")}</p>
          )}
          {call.task && (
            <p className="border-t border-border pt-2 text-xs text-muted-foreground">
              Follow-up task: &ldquo;{call.task.title}&rdquo; ({call.task.status.toLowerCase()}, due {formatDate(call.task.dueAt)})
            </p>
          )}
        </div>
      </RailCard>
    </StickyRail>
  );

  return (
    <WorkspaceShell header={header} rail={rail} tabs={<WorkspaceTabs tabs={tabs} active={tab} idPrefix="call" label="Call sections" hrefFor={hrefFor} onSelect={select} />}>
      <WorkspacePanel tab={tab} idPrefix="call">
        {tab === "transcript" && (
          <Card className={motion.enter}>
            <CardHeader>
              <CardTitle>Transcript</CardTitle>
            </CardHeader>
            <CardContent>
              <TranscriptBody turns={call.turns} analysisNote={analysisNote(call)} audio={audio} />
            </CardContent>
          </Card>
        )}
        {tab === "scores" && <ScoresSection call={call} />}
        {tab === "actions" && <ActionsSection call={call} isManager={isManager} />}
        {tab === "recording" && <RecordingSection call={call} audio={audio} />}
      </WorkspacePanel>
    </WorkspaceShell>
  );
}
