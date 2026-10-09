import { describe, expect, it } from "vitest";
import { buildCallDetail, type CallDetailInput } from "./detail";

const NOW = new Date("2026-10-09T10:00:00Z");

function input(over: Partial<CallDetailInput> = {}): CallDetailInput {
  return {
    activityId: "a1",
    occurredAt: new Date("2026-10-08T09:00:00Z"),
    payload: { direction: "Outbound", status: "completed", durationSeconds: 120, recordingUrl: "https://recordings.exotel.com/x.mp3" },
    customerName: "Riya Shah",
    clientId: "c1",
    rmId: "rm1",
    rmName: "Asha",
    review: {
      id: "r1",
      status: "ANALYZED",
      transcript: "[00:03] RM: Hello, call me on 9876543210.\n[00:08] Customer: Sure, I am worried about lock-in.",
      sentimentLabel: "mixed",
      sentimentReasoning: "Customer worried but engaged.",
      qualityScore: 71,
      overriddenScore: null,
      qualityBreakdown: [{ criterion: "needs_discovery", score: 15, maxScore: 25, notes: "Some questions." }],
      recommendationText: "Send the lock-in explainer.",
      failureReason: null,
      reviewedAt: null,
      reviewedByName: null,
      reviewNotes: null,
      task: null,
    },
    insights: [
      { id: "i1", kind: "COMMITMENT", text: "Send statement by Friday", status: "OPEN", dueAt: new Date("2026-10-10T00:00:00Z"), severity: null },
      { id: "i2", kind: "OBJECTION", text: "Worried about lock-in period", status: "OPEN", dueAt: null, severity: null },
      { id: "i3", kind: "COMPLAINT", text: "Statement was late", status: "OPEN", dueAt: null, severity: "medium" },
    ],
    ...over,
  };
}

describe("buildCallDetail", () => {
  it("masks personal identifiers in transcript turns and exposes no recording URL", () => {
    const d = buildCallDetail(input(), NOW);
    expect(d.turns).toHaveLength(2);
    expect(d.turns[0].text).not.toMatch(/9876543210/);
    expect(d.hasRecording).toBe(true);
    expect(JSON.stringify(d)).not.toContain("exotel.com");
  });
  it("groups commitments and objections and lists flags", () => {
    const d = buildCallDetail(input(), NOW);
    expect(d.commitments.map((c) => c.text)).toEqual(["Send statement by Friday"]);
    expect(d.objections.map((c) => c.text)).toEqual(["Worried about lock-in period"]);
    expect(d.flags).toEqual(["complaint"]);
    expect(d.flagDetails[0]).toMatchObject({ kind: "complaint", text: "Statement was late", severity: "medium" });
  });
  it("builds rubric rows and the effective score", () => {
    const d = buildCallDetail(input(), NOW);
    expect(d.rubric[0]).toMatchObject({ label: "Needs Discovery", score: 15, maxScore: 25 });
    expect(d.score).toBe(71);
    expect(d.aiScore).toBe(71);
  });
  it("prefers the manager override but keeps the AI score", () => {
    const base = input();
    const d = buildCallDetail(input({ review: { ...base.review!, overriddenScore: 55 } }), NOW);
    expect(d.score).toBe(55);
    expect(d.aiScore).toBe(71);
  });
  it("handles a call with no review", () => {
    const d = buildCallDetail(input({ review: null, insights: [] }), NOW);
    expect(d.turns).toEqual([]);
    expect(d.analysis).toBe("none");
    expect(d.score).toBeNull();
    expect(d.rubric).toEqual([]);
    expect(d.reviewId).toBeNull();
  });
  it("uses the stored reasoning as the summary and masks it too", () => {
    const base = input();
    const d = buildCallDetail(input({ review: { ...base.review!, sentimentReasoning: "Email riya@example.com about it." } }), NOW);
    expect(d.summary).not.toContain("riya@example.com");
  });
});
