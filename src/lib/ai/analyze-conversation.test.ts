import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeProvider } from "@/lib/ai/provider";
import { makeDeps } from "@/lib/ai/gateway/test-kit";
import { QUALITY_RUBRIC } from "@/lib/ai/quality-rubric";

vi.mock("@/lib/ai/client", () => ({ getAnthropicClient: () => { throw new Error("the SDK must not be called directly"); }, isAnthropicConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY) }));
let testDeps = makeDeps();
vi.mock("@/lib/ai/gateway/wiring", () => ({ defaultGatewayDeps: () => testDeps.deps }));

import { analyzeConversation, ANALYSIS_MODEL } from "./analyze-conversation";

const analysis = {
  sentiment: { label: "positive", score: 0.5, reasoning: "friendly" },
  qualityBreakdown: QUALITY_RUBRIC.map((c) => ({ criterion: c.key, score: c.maxScore, maxScore: c.maxScore, notes: "ok" })),
  qualityScore: QUALITY_RUBRIC.reduce((t, c) => t + c.maxScore, 0),
  recommendation: { text: "Send the statement", kind: "none" },
};
const input = { transcript: "RM: Hello\nClient: Hi, call me on 9876543210", sourceType: "CALL" as const, clientId: "c1" };
beforeEach(() => { vi.stubEnv("ANTHROPIC_API_KEY", "k"); });

describe("analyzeConversation through the gateway: same request, same parsing", () => {
  it("one user turn, the forced tool, the same model and token cap", async () => {
    testDeps = makeDeps({ provider: new FakeProvider({ toolUses: [{ id: "1", name: "submit_conversation_analysis", input: analysis }] }) });
    expect(await analyzeConversation(input)).toEqual(analysis);
    const call = (testDeps.fake as FakeProvider).calls[0];
    expect(call).toMatchObject({ maxTokens: 2048, model: ANALYSIS_MODEL, toolChoice: { name: "submit_conversation_analysis" } });
    expect(call.user).toContain("phone call transcript");
    expect(call.user).toContain("Call the submit_conversation_analysis tool with your analysis.");
  });
  it("throws when the model returns no tool block", async () => {
    testDeps = makeDeps({ provider: new FakeProvider({ text: "no" }) });
    await expect(analyzeConversation(input)).rejects.toThrow(/tool_use block/);
  });
  it("with no key it still returns the canned placeholder and calls nothing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    testDeps = makeDeps();
    const r = await analyzeConversation(input);
    expect(r.qualityScore).toBe(0);
    expect((testDeps.fake as FakeProvider).calls).toHaveLength(0);
  });
});

describe("what the gateway adds to the quality audit", () => {
  it("needs the customer's consent to AI processing of conversations", async () => {
    testDeps = makeDeps({ consent: async () => ({ allowed: false, reason: "NO_RECORD" }) });
    await expect(analyzeConversation(input)).rejects.toThrow(/not agreed to AI processing/);
    expect((testDeps.fake as FakeProvider).calls).toHaveLength(0);
  });
  it("removes a PAN from the transcript but keeps the call's phone numbers", async () => {
    testDeps = makeDeps({ provider: new FakeProvider({ toolUses: [{ id: "1", name: "submit_conversation_analysis", input: analysis }] }) });
    await analyzeConversation({ ...input, transcript: "pan ABCDE1234F, number 9876543210" });
    const user = (testDeps.fake as FakeProvider).calls[0].user;
    expect(user).not.toContain("ABCDE1234F");
    expect(user).toContain("9876543210");
  });
});
