import { describe, expect, it, vi } from "vitest";

import type { GatewayResult } from "@/lib/ai/gateway/types";

import { type CallFn, type ReviewText, runAiDetector, runAiDetectors } from "./ai-detectors";

const NOW = new Date("2026-10-13T10:00:00Z");
const review = (over: Partial<ReviewText> = {}): ReviewText => ({
  id: "r1",
  clientId: "c1",
  sourceType: "WHATSAPP_THREAD",
  assignedRmId: "rm1",
  transcript: "[OUTBOUND] Hello, the fund returns 20% guaranteed.\n[INBOUND] Is that certain?",
  ...over,
});

/** A gateway result that carries one submit_quality_flag tool use. */
const ok = (input: unknown): GatewayResult =>
  ({ kind: "ok", runId: null, correlationId: "x", text: "", toolUses: [{ id: "t", name: "submit_quality_flag", input }], blocks: [], provider: "fake", model: "fake", usage: { inputTokens: 0, outputTokens: 0, costUsdEstimate: 0 } }) as unknown as GatewayResult;

describe("runAiDetector", () => {
  it("raises a draft finding with source, category, severity and a short summary when the model flags the conversation", async () => {
    const call = vi.fn<CallFn>(async () => ok({ flagged: true, severity: "HIGH", summary: "RM promised a guaranteed return." }));
    const r = await runAiDetector("POTENTIAL_COMPLIANCE_ISSUE", review(), call, NOW);
    expect(r.outcome).toBe("flagged");
    expect(r.draft).toMatchObject({
      dedupeKey: "WHATSAPP:r1:POTENTIAL_COMPLIANCE_ISSUE",
      clientId: "c1",
      subjectUserId: "rm1",
      source: "WHATSAPP",
      category: "POTENTIAL_COMPLIANCE_ISSUE",
      severity: "HIGH",
      summary: "RM promised a guaranteed return.",
      evidenceRef: "review:r1",
      detectedAt: NOW,
    });
  });

  it("uses the purpose audit.flags with the customer as the consent subject, and names no one", async () => {
    const call = vi.fn<CallFn>(async () => ok({ flagged: false, severity: "LOW", summary: "" }));
    await runAiDetector("POOR_CONVERSATION", review(), call, NOW);
    const input = call.mock.calls[0][0];
    expect(input.purpose).toBe("audit.flags");
    expect(input.subject).toEqual({ type: "client", id: "c1" });
    expect(input.toolChoice).toEqual({ name: "submit_quality_flag" });
  });

  it("returns clear and no draft when the model does not flag", async () => {
    const call: CallFn = async () => ok({ flagged: false, severity: "LOW", summary: "" });
    const r = await runAiDetector("MISSED_OPPORTUNITY", review(), call, NOW);
    expect(r).toEqual({ category: "MISSED_OPPORTUNITY", outcome: "clear" });
  });

  it("makes no call and returns nothing when there is no stored text", async () => {
    const call = vi.fn<CallFn>();
    const r = await runAiDetector("INCORRECT_COMMUNICATION", review({ transcript: "   " }), call, NOW);
    expect(call).not.toHaveBeenCalled();
    expect(r.draft).toBeUndefined();
  });

  it("maps a consent or budget refusal to blocked, with no finding", async () => {
    const call: CallFn = async () => ({ kind: "blocked", reason: "consent_denied", runId: null, correlationId: "x" }) as GatewayResult;
    const r = await runAiDetector("POOR_CONVERSATION", review(), call, NOW);
    expect(r).toEqual({ category: "POOR_CONVERSATION", outcome: "blocked" });
  });

  it("maps a model failure and a malformed tool result to failed", async () => {
    const down: CallFn = async () => ({ kind: "failed", errorClass: "timeout", retryable: true, attempts: 2, runId: null, correlationId: "x" }) as GatewayResult;
    expect((await runAiDetector("POOR_CONVERSATION", review(), down, NOW)).outcome).toBe("failed");
    const bad: CallFn = async () => ok({ flagged: "yes" });
    expect((await runAiDetector("POOR_CONVERSATION", review(), bad, NOW)).outcome).toBe("failed");
  });

  it("keeps the summary to one line and under the length cap", async () => {
    const call: CallFn = async () => ok({ flagged: true, severity: "LOW", summary: "line one\n\nline two " + "x".repeat(500) });
    const r = await runAiDetector("POOR_CONVERSATION", review(), call, NOW);
    expect(r.draft?.summary).not.toMatch(/\n/);
    expect(r.draft!.summary.length).toBeLessThanOrEqual(200);
  });
});

describe("runAiDetectors (the AI pass)", () => {
  it("is skipped, with no call, when there is no AI key", async () => {
    const call = vi.fn<CallFn>();
    const r = await runAiDetectors({ reviews: [review()], call, hasKey: false, now: NOW });
    expect(r).toEqual({ skipped: "no_ai_key" });
    expect(call).not.toHaveBeenCalled();
  });

  it("runs all four detectors over each stored conversation and marks it scanned", async () => {
    const call = vi.fn<CallFn>(async () => ok({ flagged: false, severity: "LOW", summary: "" }));
    const r = await runAiDetectors({ reviews: [review({ id: "a" }), review({ id: "b" })], call, hasKey: true, now: NOW });
    expect(call).toHaveBeenCalledTimes(8);
    expect(r.skipped).toBeUndefined();
    if (r.skipped) return;
    expect(r.scannedReviewIds).toEqual(["a", "b"]);
    expect(r.counts.clear).toBe(8);
  });

  it("does not mark a conversation scanned when a detector failed, so the next run retries it", async () => {
    const call: CallFn = async (input) =>
      (input.user ?? "").includes("guaranteed")
        ? ({ kind: "failed", errorClass: "timeout", retryable: true, attempts: 2, runId: null, correlationId: "x" } as GatewayResult)
        : ok({ flagged: false, severity: "LOW", summary: "" });
    const r = await runAiDetectors({
      reviews: [review({ id: "a", transcript: "guaranteed returns" }), review({ id: "b", transcript: "all fine" })],
      call,
      hasKey: true,
      now: NOW,
    });
    if (r.skipped) throw new Error("unexpected skip");
    expect(r.scannedReviewIds).toEqual(["b"]);
    expect(r.counts.failed).toBe(4);
  });

  it("stops before the next conversation when the time budget is spent", async () => {
    const call = vi.fn<CallFn>(async () => ok({ flagged: false, severity: "LOW", summary: "" }));
    let n = 0;
    const r = await runAiDetectors({ reviews: [review({ id: "a" }), review({ id: "b" })], call, hasKey: true, now: NOW, shouldStop: () => n++ >= 1 });
    if (r.skipped) throw new Error("unexpected skip");
    expect(r.reviewsSeen).toBe(1);
    expect(call).toHaveBeenCalledTimes(4);
  });
});
