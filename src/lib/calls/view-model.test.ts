import { describe, expect, it } from "vitest";
import {
  applyFilters,
  buildCallRow,
  buildRollup,
  buildRubricRows,
  canViewCall,
  flagsFromInsights,
  parseCallPayload,
  parseFilters,
  scoreBand,
  type CallRecord,
} from "./view-model";

const NOW = new Date("2026-10-09T10:00:00Z");

function record(over: Partial<CallRecord> = {}): CallRecord {
  return {
    activityId: "a1",
    occurredAt: new Date("2026-10-08T09:00:00Z"),
    payload: { source: "exotel", direction: "Outbound", status: "completed", durationSeconds: 184, recordingUrl: "https://recordings.exotel.com/x.mp3" },
    clientId: "c1",
    customerName: "Riya Shah",
    rmId: "rm1",
    rmName: "Asha",
    review: { id: "r1", status: "ANALYZED", hasTranscript: true, qualityScore: 82, overriddenScore: null, sentimentLabel: "positive", reviewedAt: null },
    insights: [],
    ...over,
  };
}

describe("parseCallPayload", () => {
  it("normalises exotel and device payloads", () => {
    expect(parseCallPayload({ direction: "Inbound", status: "completed", durationSeconds: 30 })).toMatchObject({ direction: "inbound", durationSeconds: 30 });
    expect(parseCallPayload({ source: "device", direction: "OUTGOING", durationSeconds: 5 })).toMatchObject({ direction: "outbound" });
    expect(parseCallPayload({ source: "device", direction: "MISSED", durationSeconds: 0 }).direction).toBe("missed");
    expect(parseCallPayload({ direction: "REJECTED" }).direction).toBe("missed");
  });
  it("tolerates junk", () => {
    expect(parseCallPayload(null)).toMatchObject({ direction: "unknown", durationSeconds: 0, recordingUrl: null });
    expect(parseCallPayload({ durationSeconds: "x", recordingUrl: 5 })).toMatchObject({ durationSeconds: 0, recordingUrl: null });
  });
});

describe("scoreBand", () => {
  it("bands 0-49 low, 50-74 mid, 75+ high, null stays null", () => {
    expect([scoreBand(0), scoreBand(49), scoreBand(50), scoreBand(74), scoreBand(75), scoreBand(100), scoreBand(null)]).toEqual(["low", "low", "mid", "mid", "high", "high", null]);
  });
});

describe("flagsFromInsights", () => {
  const base = { status: "OPEN" as const, dueAt: null as Date | null };
  it("maps the four concern kinds and ignores dismissed rows", () => {
    const flags = flagsFromInsights(
      [
        { ...base, kind: "COMPLIANCE_CONCERN" },
        { ...base, kind: "INCORRECT_INFO" },
        { ...base, kind: "COMPLAINT" },
        { ...base, kind: "MISSED_OPPORTUNITY" },
        { ...base, kind: "INTEREST" },
        { ...base, kind: "COMPLAINT", status: "DISMISSED" as const },
      ],
      NOW,
    );
    expect(flags).toEqual(["missed_followup", "compliance", "incorrect_info", "complaint"]);
  });
  it("flags an open commitment whose due date has passed as a missed follow-up", () => {
    expect(flagsFromInsights([{ ...base, kind: "COMMITMENT", dueAt: new Date("2026-10-01T00:00:00Z") }], NOW)).toEqual(["missed_followup"]);
    expect(flagsFromInsights([{ ...base, kind: "COMMITMENT", dueAt: new Date("2026-10-20T00:00:00Z") }], NOW)).toEqual([]);
    expect(flagsFromInsights([{ ...base, kind: "COMMITMENT", status: "DONE", dueAt: new Date("2026-10-01T00:00:00Z") }], NOW)).toEqual([]);
  });
});

describe("buildCallRow", () => {
  it("builds a display row with the effective score and no phone data", () => {
    const row = buildCallRow(record(), NOW);
    expect(row).toMatchObject({ id: "a1", direction: "outbound", durationLabel: "3:04", outcome: "connected", customerName: "Riya Shah", rmName: "Asha", score: 82, band: "high", hasRecording: true, hasTranscript: true, reviewed: false });
    expect(JSON.stringify(row)).not.toMatch(/exotel\.com|mobile|phone/i);
  });
  it("prefers a manager override over the AI score", () => {
    const row = buildCallRow(record({ review: { id: "r1", status: "ANALYZED", hasTranscript: true, qualityScore: 82, overriddenScore: 40, sentimentLabel: "negative", reviewedAt: NOW } }), NOW);
    expect(row.score).toBe(40);
    expect(row.band).toBe("low");
    expect(row.reviewed).toBe(true);
  });
  it("marks calls with no review as awaiting analysis and missed calls as missed", () => {
    const row = buildCallRow(record({ review: null, payload: { source: "device", direction: "MISSED", durationSeconds: 0 } }), NOW);
    expect(row).toMatchObject({ outcome: "missed", score: null, band: null, hasRecording: false, hasTranscript: false, analysis: "none" });
  });
  it("reports analysis state from the review status", () => {
    expect(buildCallRow(record({ review: { id: "r", status: "PENDING_TRANSCRIPT", hasTranscript: false, qualityScore: null, overriddenScore: null, sentimentLabel: null, reviewedAt: null } }), NOW).analysis).toBe("pending");
    expect(buildCallRow(record({ review: { id: "r", status: "FAILED", hasTranscript: false, qualityScore: null, overriddenScore: null, sentimentLabel: null, reviewedAt: null } }), NOW).analysis).toBe("failed");
  });
  it("treats a zero-second completed call that did not connect as unanswered", () => {
    expect(buildCallRow(record({ payload: { direction: "Outbound", status: "no-answer", durationSeconds: 0 } }), NOW).outcome).toBe("unanswered");
  });
});

describe("parseFilters", () => {
  it("accepts valid values and drops invalid ones", () => {
    const f = parseFilters({ rm: "u1", from: "2026-10-01", to: "2026-10-09", outcome: "missed", band: "low", flagged: "1", recording: "1", transcript: "1" });
    expect(f).toEqual({ rm: "u1", from: "2026-10-01", to: "2026-10-09", outcome: "missed", band: "low", flaggedOnly: true, hasRecording: true, hasTranscript: true });
    const bad = parseFilters({ outcome: "bogus", band: "x", from: "yesterday", flagged: "yes" });
    expect(bad).toEqual({ rm: null, from: null, to: null, outcome: null, band: null, flaggedOnly: false, hasRecording: false, hasTranscript: false });
  });
  it("takes the first value of repeated params", () => {
    expect(parseFilters({ rm: ["u1", "u2"] }).rm).toBe("u1");
  });
});

describe("applyFilters", () => {
  const rows = [
    buildCallRow(record({ activityId: "a", insights: [{ kind: "COMPLAINT", status: "OPEN", dueAt: null }] }), NOW),
    buildCallRow(record({ activityId: "b", rmId: "rm2", rmName: "Dev", payload: { direction: "MISSED", durationSeconds: 0 }, review: null }), NOW),
    buildCallRow(record({ activityId: "c", occurredAt: new Date("2026-09-01T09:00:00Z"), review: { id: "r3", status: "ANALYZED", hasTranscript: true, qualityScore: 30, overriddenScore: null, sentimentLabel: "negative", reviewedAt: null } }), NOW),
  ];
  const none = parseFilters({});
  it("filters by RM, outcome, band, flagged, recording, transcript", () => {
    expect(applyFilters(rows, { ...none, rm: "rm2" }).map((r) => r.id)).toEqual(["b"]);
    expect(applyFilters(rows, { ...none, outcome: "missed" }).map((r) => r.id)).toEqual(["b"]);
    expect(applyFilters(rows, { ...none, band: "low" }).map((r) => r.id)).toEqual(["c"]);
    expect(applyFilters(rows, { ...none, flaggedOnly: true }).map((r) => r.id)).toEqual(["a"]);
    expect(applyFilters(rows, { ...none, hasRecording: true }).map((r) => r.id)).toEqual(["a", "c"]);
    expect(applyFilters(rows, { ...none, hasTranscript: true }).map((r) => r.id)).toEqual(["a", "c"]);
  });
  it("filters by inclusive date range on the call date (IST)", () => {
    expect(applyFilters(rows, { ...none, from: "2026-10-08", to: "2026-10-08" }).map((r) => r.id)).toEqual(["a", "b"]);
    expect(applyFilters(rows, { ...none, to: "2026-09-30" }).map((r) => r.id)).toEqual(["c"]);
  });
});

describe("buildRollup", () => {
  it("averages score by RM, counts flags and reviewed calls", () => {
    const rows = [
      buildCallRow(record({ activityId: "1", review: { id: "r1", status: "ANALYZED", hasTranscript: true, qualityScore: 80, overriddenScore: null, sentimentLabel: null, reviewedAt: NOW }, insights: [{ kind: "COMPLAINT", status: "OPEN", dueAt: null }] }), NOW),
      buildCallRow(record({ activityId: "2", review: { id: "r2", status: "ANALYZED", hasTranscript: true, qualityScore: 60, overriddenScore: null, sentimentLabel: null, reviewedAt: null }, insights: [{ kind: "COMPLAINT", status: "OPEN", dueAt: null }, { kind: "INCORRECT_INFO", status: "OPEN", dueAt: null }] }), NOW),
      buildCallRow(record({ activityId: "3", rmId: "rm2", rmName: "Dev", review: null }), NOW),
    ];
    const r = buildRollup(rows);
    expect(r.totalCalls).toBe(3);
    expect(r.scoredCalls).toBe(2);
    expect(r.reviewedCalls).toBe(1);
    expect(r.averageScore).toBe(70);
    expect(r.byRm).toEqual([
      { rmId: "rm1", rmName: "Asha", calls: 2, scored: 2, average: 70 },
      { rmId: "rm2", rmName: "Dev", calls: 1, scored: 0, average: null },
    ]);
    expect(r.topFlags).toEqual([
      { kind: "complaint", count: 2 },
      { kind: "incorrect_info", count: 1 },
    ]);
  });
  it("is empty-safe", () => {
    expect(buildRollup([])).toEqual({ totalCalls: 0, scoredCalls: 0, reviewedCalls: 0, averageScore: null, byRm: [], topFlags: [] });
  });
});

describe("canViewCall", () => {
  it("lets admins (null scope) see everything", () => {
    expect(canViewCall(null, { rmId: "x", activityUserId: null, clientAssignedToId: null })).toBe(true);
  });
  it("lets a scoped user see calls tied to anyone in scope", () => {
    const scope = ["rm1", "rm2"];
    expect(canViewCall(scope, { rmId: "rm1", activityUserId: null, clientAssignedToId: null })).toBe(true);
    expect(canViewCall(scope, { rmId: null, activityUserId: "rm2", clientAssignedToId: null })).toBe(true);
    expect(canViewCall(scope, { rmId: null, activityUserId: null, clientAssignedToId: "rm1" })).toBe(true);
    expect(canViewCall(scope, { rmId: "rm9", activityUserId: "rm9", clientAssignedToId: "rm9" })).toBe(false);
    expect(canViewCall(scope, { rmId: null, activityUserId: null, clientAssignedToId: null })).toBe(false);
  });
});

describe("buildRubricRows", () => {
  it("labels criteria from the rubric and carries evidence quotes when present", () => {
    const rows = buildRubricRows([
      { criterion: "needs_discovery", score: 20, maxScore: 25, notes: "Asked about goals.", evidence: ["What are you saving for?"] },
      { criterion: "mystery", score: 3, maxScore: 5, notes: "x" },
    ]);
    expect(rows[0]).toMatchObject({ key: "needs_discovery", label: "Needs Discovery", score: 20, maxScore: 25, evidence: ["What are you saving for?"] });
    expect(rows[1]).toMatchObject({ label: "mystery", evidence: [] });
  });
  it("returns nothing for a non-array", () => {
    expect(buildRubricRows(null)).toEqual([]);
    expect(buildRubricRows({})).toEqual([]);
  });
});
