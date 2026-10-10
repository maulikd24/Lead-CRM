import { QUALITY_RUBRIC } from "@/lib/ai/quality-rubric";

/**
 * Pure view-model builders for the call recordings review (/calls). The loaders in ./queries.ts fetch rows; everything
 * here turns them into what the screens show. Deliberately no phone numbers, recording URLs or transcripts in the
 * output rows: a row only says *whether* a recording / transcript exists.
 */

export type FlagKind = "missed_followup" | "compliance" | "incorrect_info" | "complaint";
export const FLAG_ORDER: FlagKind[] = ["missed_followup", "compliance", "incorrect_info", "complaint"];
export const FLAG_LABEL: Record<FlagKind, string> = {
  missed_followup: "Missed follow-up",
  compliance: "Compliance concern",
  incorrect_info: "Incorrect info",
  complaint: "Complaint",
};

export type Direction = "inbound" | "outbound" | "missed" | "unknown";
export type Outcome = "connected" | "missed" | "unanswered";
export type Band = "low" | "mid" | "high";
export type AnalysisState = "none" | "pending" | "analyzing" | "done" | "failed";

export const OUTCOME_LABEL: Record<Outcome, string> = { connected: "Connected", missed: "Missed", unanswered: "Not answered" };
export const BAND_LABEL: Record<Band, string> = { low: "Needs attention (under 50)", mid: "Fair (50 to 74)", high: "Strong (75 and above)" };

export type ParsedCallPayload = { direction: Direction; status: string; durationSeconds: number; recordingUrl: string | null };

export function parseCallPayload(payload: unknown): ParsedCallPayload {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const raw = typeof p.direction === "string" ? p.direction.toLowerCase() : "";
  let direction: Direction = "unknown";
  if (raw === "inbound" || raw === "incoming") direction = "inbound";
  else if (raw === "outbound" || raw === "outgoing") direction = "outbound";
  else if (raw === "missed" || raw === "rejected") direction = "missed";
  const dur = typeof p.durationSeconds === "number" && Number.isFinite(p.durationSeconds) ? Math.max(0, Math.round(p.durationSeconds)) : 0;
  return {
    direction,
    status: typeof p.status === "string" ? p.status.toLowerCase() : "",
    durationSeconds: dur,
    recordingUrl: typeof p.recordingUrl === "string" && p.recordingUrl.trim() ? p.recordingUrl.trim() : null,
  };
}

export function scoreBand(score: number | null): Band | null {
  if (score === null) return null;
  if (score < 50) return "low";
  if (score < 75) return "mid";
  return "high";
}

function callOutcome(p: ParsedCallPayload): Outcome {
  if (p.direction === "missed") return "missed";
  if (p.durationSeconds > 0) return "connected";
  return "unanswered";
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export type InsightLite = { kind: string; status: "OPEN" | "DONE" | "DISMISSED"; dueAt: Date | null };

export function flagsFromInsights(insights: InsightLite[], now: Date): FlagKind[] {
  const found = new Set<FlagKind>();
  for (const i of insights) {
    if (i.status === "DISMISSED") continue;
    if (i.kind === "MISSED_OPPORTUNITY") found.add("missed_followup");
    else if (i.kind === "COMPLIANCE_CONCERN") found.add("compliance");
    else if (i.kind === "INCORRECT_INFO") found.add("incorrect_info");
    else if (i.kind === "COMPLAINT") found.add("complaint");
    else if (i.kind === "COMMITMENT" && i.status === "OPEN" && i.dueAt && i.dueAt.getTime() < now.getTime()) found.add("missed_followup");
  }
  return FLAG_ORDER.filter((f) => found.has(f));
}

export type ReviewLite = {
  id: string;
  status: "PENDING_TRANSCRIPT" | "ANALYZING" | "ANALYZED" | "FAILED";
  hasTranscript: boolean;
  qualityScore: number | null;
  overriddenScore: number | null;
  sentimentLabel: string | null;
  reviewedAt: Date | null;
};

export type CallRecord = {
  activityId: string;
  occurredAt: Date;
  payload: unknown;
  clientId: string;
  customerName: string;
  rmId: string | null;
  rmName: string | null;
  review: ReviewLite | null;
  insights: InsightLite[];
};

export type CallRow = {
  id: string;
  occurredAt: Date;
  direction: Direction;
  outcome: Outcome;
  durationSeconds: number;
  durationLabel: string;
  customerName: string;
  clientId: string;
  rmId: string | null;
  rmName: string | null;
  score: number | null;
  band: Band | null;
  sentiment: string | null;
  flags: FlagKind[];
  hasRecording: boolean;
  hasTranscript: boolean;
  reviewed: boolean;
  analysis: AnalysisState;
};

const ANALYSIS_BY_STATUS: Record<ReviewLite["status"], AnalysisState> = { PENDING_TRANSCRIPT: "pending", ANALYZING: "analyzing", ANALYZED: "done", FAILED: "failed" };

export function buildCallRow(record: CallRecord, now: Date): CallRow {
  const p = parseCallPayload(record.payload);
  const review = record.review;
  const score = review ? (review.overriddenScore ?? review.qualityScore) : null;
  return {
    id: record.activityId,
    occurredAt: record.occurredAt,
    direction: p.direction,
    outcome: callOutcome(p),
    durationSeconds: p.durationSeconds,
    durationLabel: formatDuration(p.durationSeconds),
    customerName: record.customerName,
    clientId: record.clientId,
    rmId: record.rmId,
    rmName: record.rmName,
    score,
    band: scoreBand(score),
    sentiment: review?.sentimentLabel ?? null,
    flags: flagsFromInsights(record.insights, now),
    hasRecording: p.recordingUrl !== null,
    hasTranscript: review?.hasTranscript ?? false,
    reviewed: review?.reviewedAt != null,
    analysis: review ? ANALYSIS_BY_STATUS[review.status] : "none",
  };
}

// ---- filters -----------------------------------------------------------------------------------------------------

export type CallFilters = {
  rm: string | null;
  from: string | null;
  to: string | null;
  outcome: Outcome | null;
  band: Band | null;
  flaggedOnly: boolean;
  hasRecording: boolean;
  hasTranscript: boolean;
};

const first = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseFilters(params: Record<string, string | string[] | undefined>): CallFilters {
  const outcome = first(params.outcome);
  const band = first(params.band);
  const from = first(params.from);
  const to = first(params.to);
  return {
    rm: first(params.rm) || null,
    from: from && DATE.test(from) ? from : null,
    to: to && DATE.test(to) ? to : null,
    outcome: outcome === "connected" || outcome === "missed" || outcome === "unanswered" ? outcome : null,
    band: band === "low" || band === "mid" || band === "high" ? band : null,
    flaggedOnly: first(params.flagged) === "1",
    hasRecording: first(params.recording) === "1",
    hasTranscript: first(params.transcript) === "1",
  };
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of the IST calendar day for a yyyy-mm-dd string, as a UTC instant. */
export function istDayStart(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) - IST_OFFSET_MS);
}
export function istDayEnd(date: string): Date {
  return new Date(istDayStart(date).getTime() + DAY_MS - 1);
}

export function applyFilters(rows: CallRow[], f: CallFilters): CallRow[] {
  const from = f.from ? istDayStart(f.from).getTime() : null;
  const to = f.to ? istDayEnd(f.to).getTime() : null;
  return rows.filter((r) => {
    const t = r.occurredAt.getTime();
    if (f.rm && r.rmId !== f.rm) return false;
    if (from !== null && t < from) return false;
    if (to !== null && t > to) return false;
    if (f.outcome && r.outcome !== f.outcome) return false;
    if (f.band && r.band !== f.band) return false;
    if (f.flaggedOnly && r.flags.length === 0) return false;
    if (f.hasRecording && !r.hasRecording) return false;
    if (f.hasTranscript && !r.hasTranscript) return false;
    return true;
  });
}

// ---- manager rollup ----------------------------------------------------------------------------------------------

export type Rollup = {
  totalCalls: number;
  scoredCalls: number;
  reviewedCalls: number;
  averageScore: number | null;
  byRm: { rmId: string | null; rmName: string; calls: number; scored: number; average: number | null }[];
  topFlags: { kind: FlagKind; count: number }[];
};

const mean = (values: number[]): number | null => (values.length === 0 ? null : Math.round(values.reduce((a, b) => a + b, 0) / values.length));

export function buildRollup(rows: CallRow[]): Rollup {
  const scored = rows.filter((r) => r.score !== null);
  const groups = new Map<string, { rmId: string | null; rmName: string; calls: number; scores: number[] }>();
  for (const r of rows) {
    const key = r.rmId ?? "__none";
    const g = groups.get(key) ?? { rmId: r.rmId, rmName: r.rmName ?? "Unassigned", calls: 0, scores: [] };
    g.calls += 1;
    if (r.score !== null) g.scores.push(r.score);
    groups.set(key, g);
  }
  const flagCounts = new Map<FlagKind, number>();
  for (const r of rows) for (const f of r.flags) flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);

  return {
    totalCalls: rows.length,
    scoredCalls: scored.length,
    reviewedCalls: rows.filter((r) => r.reviewed).length,
    averageScore: mean(scored.map((r) => r.score as number)),
    byRm: [...groups.values()]
      .map((g) => ({ rmId: g.rmId, rmName: g.rmName, calls: g.calls, scored: g.scores.length, average: mean(g.scores) }))
      .sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || b.calls - a.calls || a.rmName.localeCompare(b.rmName)),
    topFlags: FLAG_ORDER.map((kind) => ({ kind, count: flagCounts.get(kind) ?? 0 }))
      .filter((f) => f.count > 0)
      .sort((a, b) => b.count - a.count),
  };
}

// ---- access ------------------------------------------------------------------------------------------------------

/** `scope` is getVisibleUserIds(): null = unrestricted. A call is visible when the RM on the review, the user who logged
 *  it, or the customer's assigned RM is in scope. */
export function canViewCall(scope: string[] | null, call: { rmId: string | null; activityUserId: string | null; clientAssignedToId: string | null }): boolean {
  if (scope === null) return true;
  return [call.rmId, call.activityUserId, call.clientAssignedToId].some((id) => id !== null && scope.includes(id));
}

// ---- rubric ------------------------------------------------------------------------------------------------------

export type RubricRow = { key: string; label: string; score: number; maxScore: number; notes: string; evidence: string[] };

/** The stored breakdown is {criterion, score, maxScore, notes}. Evidence quotes are shown when a breakdown entry carries
 *  an `evidence` string or list; nothing is invented when it does not. */
export function buildRubricRows(breakdown: unknown): RubricRow[] {
  if (!Array.isArray(breakdown)) return [];
  const rows: RubricRow[] = [];
  for (const item of breakdown) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    if (typeof c.criterion !== "string" || typeof c.score !== "number" || typeof c.maxScore !== "number") continue;
    const rubric = QUALITY_RUBRIC.find((r) => r.key === c.criterion);
    const evidenceRaw = c.evidence;
    const evidence = Array.isArray(evidenceRaw) ? evidenceRaw.filter((e): e is string => typeof e === "string") : typeof evidenceRaw === "string" ? [evidenceRaw] : [];
    rows.push({ key: c.criterion, label: rubric?.label ?? c.criterion, score: c.score, maxScore: c.maxScore, notes: typeof c.notes === "string" ? c.notes : "", evidence });
  }
  return rows;
}

/** The note above the call list about AI scoring, or null. It must never contradict the scores on screen. */
export function analysisNotice({ aiConfigured, scored, total }: { aiConfigured: boolean; scored: number; total: number }): string | null {
  if (aiConfigured || total === 0) return null;
  if (scored > 0) return "New calls are not being scored automatically in this environment. The scores shown were recorded earlier.";
  return "AI analysis is switched off in this environment, so calls show recordings and transcripts but no scores.";
}
