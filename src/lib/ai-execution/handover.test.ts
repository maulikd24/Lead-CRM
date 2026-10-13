import { describe, expect, it, vi } from "vitest";

import { CUSTOMER_MESSAGE_DRAFT } from "./approval";
import { buildHandoverSummary, detectHandoverTriggers, formatInr, HIGH_VALUE_INR, recordAiHandover, recommendedFollowUp, type HandoverDeps, type HandoverInput } from "./handover";

const quiet = { inboundText: "ok thanks", portfolioValueInr: null, openIssueKinds: [] };

describe("handover triggers are deterministic (the bible's five)", () => {
  it("serious investment interest", () => {
    expect(detectHandoverTriggers({ ...quiet, inboundText: "I am interested, I want to invest in the PMS" })).toContain("serious_interest");
    expect(detectHandoverTriggers({ ...quiet, inboundText: "Ready to start, let's do it" })).toContain("serious_interest");
  });
  it("needs personalised advice", () => {
    expect(detectHandoverTriggers({ ...quiet, inboundText: "Should I sell my largecaps?" })).toContain("needs_advice");
    expect(detectHandoverTriggers({ ...quiet, inboundText: "Can you give me advice on this?" })).toContain("needs_advice");
  });
  it("a high-value opportunity, at or above one crore", () => {
    expect(detectHandoverTriggers({ ...quiet, portfolioValueInr: 12_000_000 })).toContain("high_value");
    expect(detectHandoverTriggers({ ...quiet, portfolioValueInr: HIGH_VALUE_INR })).toContain("high_value");
    expect(detectHandoverTriggers({ ...quiet, portfolioValueInr: 9_999_999 })).not.toContain("high_value");
  });
  it("a complex question (a tax or lock-in question, or two questions)", () => {
    expect(detectHandoverTriggers({ ...quiet, inboundText: "What is the tax on exit?" })).toContain("complex_question");
    expect(detectHandoverTriggers({ ...quiet, inboundText: "How does this work? What about nominee?" })).toContain("complex_question");
  });
  it("a sensitive service issue (an open complaint, or complaint wording in the message)", () => {
    expect(detectHandoverTriggers({ ...quiet, openIssueKinds: ["complaint"] })).toContain("sensitive_service_issue");
    expect(detectHandoverTriggers({ ...quiet, inboundText: "This is fraud, I want my money back" })).toContain("sensitive_service_issue");
  });
  it("does not trigger on an ordinary message", () => {
    expect(detectHandoverTriggers(quiet)).toEqual([]);
  });
});

describe("the summary the RM reads first", () => {
  it("formats the portfolio value in crores and lakhs", () => {
    expect(formatInr(12_000_000)).toBe("₹1.2 Cr");
    expect(formatInr(250_000)).toBe("₹2.5 L");
    expect(formatInr(null)).toBe("not known");
  });
  it("names the recommended follow-up from the most serious trigger", () => {
    expect(recommendedFollowUp(["high_value", "sensitive_service_issue"])).toMatch(/Service call/);
    expect(recommendedFollowUp(["serious_interest", "needs_advice"])).toMatch(/Suitability/);
    expect(recommendedFollowUp(["high_value"])).toMatch(/Portfolio review/);
  });
  it("is short, structured, and never invents what is not known", () => {
    const s = buildHandoverSummary({ triggers: ["serious_interest"], interest: null, portfolioValueInr: null, mainConcern: null });
    expect(s.text).toContain("Interest: no stated interest recorded");
    expect(s.text).toContain("Portfolio: value not known");
    expect(s.text).toContain("Main concern: none recorded");
    expect(s.text).toContain("Recommended follow-up:");
    expect(s.text.length).toBeLessThan(500);
  });
});

function deps(over: Partial<HandoverDeps> = {}) {
  const captureOutcome = vi.fn<(input: unknown) => Promise<unknown>>(async () => ({ id: "outcome-1" }));
  const requestApproval = vi.fn<(type: unknown, input: unknown, actor: unknown) => Promise<{ id: string }>>(async () => ({ id: "ar-7" }));
  return {
    deps: { hasOpenHandover: async () => false, captureOutcome, requestApproval: requestApproval as unknown as HandoverDeps["requestApproval"], now: () => new Date("2026-10-13T10:00:00Z"), ...over } as HandoverDeps,
    captureOutcome,
    requestApproval,
  };
}

const input: HandoverInput = {
  clientId: "client-1", actor: { id: "rm-1", role: "RM" }, inboundText: "I am interested, should I invest in a PMS?", portfolioValueInr: 12_000_000,
  openIssueKinds: [], interest: "PMS after a diversification talk", mainConcern: "lock-in and downside",
};

describe("AI-to-RM handover", () => {
  it("does nothing when no trigger fires", async () => {
    const d = deps();
    const r = await recordAiHandover({ ...input, inboundText: "thanks", portfolioValueInr: null }, d.deps);
    expect(r).toEqual({ status: "not_triggered" });
    expect(d.captureOutcome).not.toHaveBeenCalled();
  });

  it("hands over through the existing outcome path, as an RM_HANDOVER with the structured summary", async () => {
    const d = deps();
    const r = await recordAiHandover(input, d.deps);
    expect(r.status).toBe("handed_over");
    expect(d.captureOutcome).toHaveBeenCalledTimes(1);
    const call = d.captureOutcome.mock.calls[0][0] as unknown as { outcome: string; actorType: string; summary: string };
    expect(call.outcome).toBe("RM_HANDOVER");
    expect(call.actorType).toBe("AI_AGENT");
    expect(call.summary).toContain("Portfolio: approx. ₹1.2 Cr");
    expect(call.summary).toContain("Main concern: lock-in and downside");
  });

  it("creates NO ApprovalRequest when no customer message is involved", async () => {
    const d = deps();
    const r = await recordAiHandover(input, d.deps);
    expect(r).toMatchObject({ status: "handed_over", approvalRequestId: null });
    expect(d.requestApproval).not.toHaveBeenCalled();
  });

  it("creates an ApprovalRequest when a holding message goes to the customer", async () => {
    const d = deps();
    const r = await recordAiHandover({ ...input, customerMessage: "Our RM will call you this week." }, d.deps);
    expect(r).toMatchObject({ status: "handed_over", approvalRequestId: "ar-7" });
    expect(d.requestApproval.mock.calls[0][0]).toBe(CUSTOMER_MESSAGE_DRAFT);
  });

  it("is idempotent: no second handover while one to a person is already open", async () => {
    const d = deps({ hasOpenHandover: async () => true });
    const r = await recordAiHandover(input, d.deps);
    expect(r.status).toBe("already_open");
    expect(d.captureOutcome).not.toHaveBeenCalled();
  });
});
