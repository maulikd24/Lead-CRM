import { maskSensitive, parseTranscript, type TranscriptTurn } from "./transcript";
import { buildRubricRows, flagsFromInsights, parseCallPayload, scoreBand, formatDuration, type AnalysisState, type Band, type Direction, type FlagKind, type InsightLite, type Outcome, type RubricRow } from "./view-model";

export type InsightRow = { id: string; kind: string; text: string; status: "OPEN" | "DONE" | "DISMISSED"; dueAt: Date | null; severity: string | null };

export type CallDetailInput = {
  activityId: string;
  occurredAt: Date;
  payload: unknown;
  customerName: string;
  clientId: string;
  rmId: string | null;
  rmName: string | null;
  review: {
    id: string;
    status: "PENDING_TRANSCRIPT" | "ANALYZING" | "ANALYZED" | "FAILED";
    transcript: string | null;
    sentimentLabel: string | null;
    sentimentReasoning: string | null;
    qualityScore: number | null;
    overriddenScore: number | null;
    qualityBreakdown: unknown;
    recommendationText: string | null;
    failureReason: string | null;
    reviewedAt: Date | null;
    reviewedByName: string | null;
    reviewNotes: string | null;
    task: { id: string; title: string; status: string; dueAt: Date } | null;
  } | null;
  insights: InsightRow[];
};

export type CallDetail = {
  id: string;
  reviewId: string | null;
  occurredAt: Date;
  customerName: string;
  clientId: string;
  rmId: string | null;
  rmName: string | null;
  direction: Direction;
  outcome: Outcome | null;
  durationLabel: string;
  hasRecording: boolean;
  analysis: AnalysisState;
  failureReason: string | null;
  turns: TranscriptTurn[];
  summary: string | null;
  sentiment: string | null;
  score: number | null;
  aiScore: number | null;
  band: Band | null;
  rubric: RubricRow[];
  recommendation: string | null;
  commitments: InsightRow[];
  objections: InsightRow[];
  flags: FlagKind[];
  flagDetails: { kind: FlagKind; text: string; severity: string | null }[];
  reviewedAt: Date | null;
  reviewedByName: string | null;
  reviewNotes: string | null;
  task: { id: string; title: string; status: string; dueAt: Date } | null;
};

const ANALYSIS: Record<NonNullable<CallDetailInput["review"]>["status"], AnalysisState> = { PENDING_TRANSCRIPT: "pending", ANALYZING: "analyzing", ANALYZED: "done", FAILED: "failed" };
const FLAG_FOR_KIND: Record<string, FlagKind> = { COMPLIANCE_CONCERN: "compliance", INCORRECT_INFO: "incorrect_info", COMPLAINT: "complaint", MISSED_OPPORTUNITY: "missed_followup" };

const mask = (t: string | null) => (t ? maskSensitive(t) : null);
const maskInsight = (i: InsightRow): InsightRow => ({ ...i, text: maskSensitive(i.text) });

/** Everything the detail page shows, with identifiers masked on the server so unmasked text never reaches the browser. */
export function buildCallDetail(input: CallDetailInput, now: Date): CallDetail {
  const p = parseCallPayload(input.payload);
  const review = input.review;
  const liveInsights = input.insights.filter((i) => i.status !== "DISMISSED");
  const lite: InsightLite[] = input.insights.map((i) => ({ kind: i.kind, status: i.status, dueAt: i.dueAt }));
  const score = review ? (review.overriddenScore ?? review.qualityScore) : null;

  return {
    id: input.activityId,
    reviewId: review?.id ?? null,
    occurredAt: input.occurredAt,
    customerName: input.customerName,
    clientId: input.clientId,
    rmId: input.rmId,
    rmName: input.rmName,
    direction: p.direction,
    outcome: p.direction === "missed" ? "missed" : p.durationSeconds > 0 ? "connected" : "unanswered",
    durationLabel: formatDuration(p.durationSeconds),
    hasRecording: p.recordingUrl !== null,
    analysis: review ? ANALYSIS[review.status] : "none",
    failureReason: review?.status === "FAILED" ? mask(review.failureReason) : null,
    turns: parseTranscript(review?.transcript).map((t) => ({ ...t, text: maskSensitive(t.text) })),
    summary: mask(review?.sentimentReasoning ?? null),
    sentiment: review?.sentimentLabel ?? null,
    score,
    aiScore: review?.qualityScore ?? null,
    band: scoreBand(score),
    rubric: buildRubricRows(review?.qualityBreakdown).map((r) => ({ ...r, notes: maskSensitive(r.notes), evidence: r.evidence.map(maskSensitive) })),
    recommendation: mask(review?.recommendationText ?? null),
    commitments: liveInsights.filter((i) => i.kind === "COMMITMENT").map(maskInsight),
    objections: liveInsights.filter((i) => i.kind === "OBJECTION").map(maskInsight),
    flags: flagsFromInsights(lite, now),
    flagDetails: liveInsights
      .filter((i) => FLAG_FOR_KIND[i.kind])
      .map((i) => ({ kind: FLAG_FOR_KIND[i.kind], text: maskSensitive(i.text), severity: i.severity })),
    reviewedAt: review?.reviewedAt ?? null,
    reviewedByName: review?.reviewedByName ?? null,
    reviewNotes: review?.reviewNotes ?? null,
    task: review?.task ?? null,
  };
}
