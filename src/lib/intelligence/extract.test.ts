import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeProvider } from "@/lib/ai/provider";
import { makeDeps } from "@/lib/ai/gateway/test-kit";

vi.mock("@/lib/db/prisma", () => ({ prisma: {}, basePrisma: {} }));
vi.mock("@/lib/ai/client", () => ({ getAnthropicClient: () => { throw new Error("the SDK must not be called directly"); }, isAnthropicConfigured: () => true }));
vi.mock("@/lib/stage-engine/create-task-if-not-exists", () => ({ createTaskIfNotExists: vi.fn() }));
vi.mock("./refresh", () => ({ refreshCustomerIntelligence: vi.fn() }));

let testDeps = makeDeps();
vi.mock("@/lib/ai/gateway/wiring", () => ({ defaultGatewayDeps: () => testDeps.deps }));

import { extractInsights } from "./extract";

const TOOL_INPUT = { insights: [{ kind: "INTEREST", text: "Interested in PMS", assetClass: "PMS" }] };
const input = { text: "Customer: I want to know about PMS.\nRM: Sure.", sourceLabel: "Phone call between an RM and a customer", today: new Date("2026-10-12T00:00:00Z"), clientId: "c1" };
beforeEach(() => { vi.stubEnv("ANTHROPIC_API_KEY", "k"); });

describe("extractInsights through the gateway: same request, same parsing", () => {
  it("sends one user turn with the same rules, the forced tool, and parses the tool input", async () => {
    testDeps = makeDeps({ provider: new FakeProvider({ toolUses: [{ id: "1", name: "submit_customer_insights", input: TOOL_INPUT }], stopReason: "tool_use" }) });
    const out = await extractInsights(input);
    expect(out).toEqual(TOOL_INPUT);
    const call = (testDeps.fake as FakeProvider).calls[0];
    expect(call).toMatchObject({ maxTokens: 2048, model: "claude-sonnet-5-5", toolChoice: { name: "submit_customer_insights" } });
    expect(call.tools?.[0].name).toBe("submit_customer_insights");
    expect(call.user).toContain("Today is 2026-10-12.");
    expect(call.user).toContain("Source: Phone call between an RM and a customer");
    expect(call.user).toContain("Call the submit_customer_insights tool with the result.");
    expect(call.user).toContain("Customer: I want to know about PMS.");
  });
  it("throws when the model returns no insights block", async () => {
    testDeps = makeDeps({ provider: new FakeProvider({ text: "hmm", stopReason: "end_turn" }) });
    await expect(extractInsights(input)).rejects.toThrow(/did not return insights/);
  });
  it("rejects output that does not match the schema", async () => {
    testDeps = makeDeps({ provider: new FakeProvider({ toolUses: [{ id: "1", name: "submit_customer_insights", input: { insights: [{ kind: "NOPE", text: "x" }] } }] }) });
    await expect(extractInsights(input)).rejects.toThrow();
  });
  it("still tail-truncates to 12,000 characters", async () => {
    testDeps = makeDeps({ provider: new FakeProvider({ toolUses: [{ id: "1", name: "submit_customer_insights", input: { insights: [] } }] }) });
    await extractInsights({ ...input, text: "a".repeat(20_000) + "END" });
    const user = (testDeps.fake as FakeProvider).calls[0].user;
    expect(user).toContain("END");
    expect(user.match(/a+/g)?.sort((x, y) => y.length - x.length)[0].length).toBeLessThanOrEqual(12_000);
  });
  it("returns null with no API key, as before, and calls nothing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    testDeps = makeDeps();
    expect(await extractInsights(input)).toBeNull();
    expect((testDeps.fake as FakeProvider).calls).toHaveLength(0);
  });
});

describe("what the gateway adds to extraction", () => {
  it("needs the customer's AI-processing consent: a denial skips the source and sends nothing", async () => {
    testDeps = makeDeps({ consent: async (...a) => { expect(a).toEqual(["c1", "AI_PROCESSING_OF_CHATS", null]); return { allowed: false, reason: "WITHDRAWN" }; } });
    expect(await extractInsights(input)).toEqual({ skipped: "consent_denied" });
    expect((testDeps.fake as FakeProvider).calls).toHaveLength(0);
  });
  it("a do-not-contact customer is skipped too", async () => {
    testDeps = makeDeps({ consent: async () => ({ allowed: false, reason: "DO_NOT_CONTACT" }) });
    expect(await extractInsights(input)).toEqual({ skipped: "do_not_contact" });
  });
  it("a PAN in the transcript never reaches the model, though contact details in it do (the purpose reads transcripts)", async () => {
    testDeps = makeDeps({ provider: new FakeProvider({ toolUses: [{ id: "1", name: "submit_customer_insights", input: { insights: [] } }] }) });
    await extractInsights({ ...input, text: "my pan is ABCDE1234F and my number 9876543210" });
    const user = (testDeps.fake as FakeProvider).calls[0].user;
    expect(user).not.toContain("ABCDE1234F");
    expect(user).toContain("9876543210");
  });
  it("other refusals surface as errors so the caller's per-source catch logs them", async () => {
    testDeps = makeDeps({ env: { AI_KILL_SWITCH: "1" } });
    await expect(extractInsights(input)).rejects.toThrow(/switched off/);
  });
});
