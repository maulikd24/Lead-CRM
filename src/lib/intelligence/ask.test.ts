import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeProvider } from "@/lib/ai/provider";
import { makeDeps } from "@/lib/ai/gateway/test-kit";

const management = vi.hoisted(() => ({
  getFunnel: vi.fn(async () => ({ customers: 10, kycApproved: 6 })),
  getLifecycleCounts: vi.fn(async () => []), getSegmentCounts: vi.fn(async () => []), getTeamFollowups: vi.fn(async () => []),
  getTopObjections: vi.fn(async () => []), listCustomers: vi.fn(async () => ({ total: 0, rows: [] })),
}));
vi.mock("./management", () => management);
vi.mock("@/lib/reports/get-reports-page-data", () => ({ getReportsPageData: vi.fn(async () => ({ conversionData: [] })) }));
vi.mock("@/lib/ai/client", () => ({ getAnthropicClient: () => { throw new Error("the SDK must not be called directly"); }, isAnthropicConfigured: () => true }));

let testDeps = makeDeps();
vi.mock("@/lib/ai/gateway/wiring", () => ({ defaultGatewayDeps: () => testDeps.deps }));

import { askTheSystem } from "./ask";

const scope = {} as never;
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("ANTHROPIC_API_KEY", "k"); });

describe("askTheSystem through the gateway: same loop as the direct Anthropic call", () => {
  it("runs a tool round, feeds the result back, and returns the final answer", async () => {
    let n = 0;
    testDeps = makeDeps({ provider: new FakeProvider(() => (++n === 1 ? { toolUses: [{ id: "tu1", name: "funnel", input: {} }], text: "", stopReason: "tool_use" } : { text: "10 customers, 6 KYC approved.", stopReason: "end_turn" })) });
    const r = await askTheSystem("How is the funnel?", scope, null, "ADMIN");
    expect(r.answer).toBe("10 customers, 6 KYC approved.");
    const calls = (testDeps.fake as FakeProvider).calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ maxTokens: 1024, model: "claude-sonnet-5-5" });
    expect(calls[0].system).toMatch(/^You answer management questions about a wealth-management firm's customers using the provided tools only\. Today is \d{4}-\d{2}-\d{2}\./);
    expect(calls[0].messages?.[0]).toEqual({ role: "user", content: "How is the funnel?" });
    expect(calls[0].tools?.map((t) => t.name)).toContain("find_customers");
    const second = calls[1].messages!;
    expect(second[1]).toMatchObject({ role: "assistant", content: [{ type: "tool_use", id: "tu1", name: "funnel" }] });
    expect(second[2]).toEqual({ role: "user", content: [{ type: "tool_result", toolUseId: "tu1", content: JSON.stringify({ customers: 10, kycApproved: 6 }) }] });
    expect(management.getFunnel).toHaveBeenCalledTimes(1);
  });
  it("still limits the question to 500 characters, and the role's tools to askToolAllowed", async () => {
    testDeps = makeDeps({ provider: new FakeProvider({ text: "ok", stopReason: "end_turn" }) });
    await askTheSystem("x".repeat(900), scope, null, "ADMIN");
    expect((testDeps.fake as FakeProvider).calls[0].messages?.[0].content).toHaveLength(500);
    await expect(askTheSystem("q", scope, null, "NOT_A_ROLE")).rejects.toThrow(/cannot use Ask/);
  });
  it("gives up after five rounds with the same message", async () => {
    testDeps = makeDeps({ provider: new FakeProvider({ toolUses: [{ id: "t", name: "funnel", input: {} }], stopReason: "tool_use" }) });
    const r = await askTheSystem("loop", scope, null, "ADMIN");
    expect(r.answer).toMatch(/more steps than I allow/);
    expect((testDeps.fake as FakeProvider).calls).toHaveLength(5);
  });
  it("a tool the role may not use comes back as an error result, not data", async () => {
    let n = 0;
    testDeps = makeDeps({ provider: new FakeProvider(() => (++n === 1 ? { toolUses: [{ id: "t", name: "bogus_tool", input: {} }], stopReason: "tool_use" } : { text: "done", stopReason: "end_turn" })) });
    await askTheSystem("q", scope, null, "ADMIN");
    const msgs = (testDeps.fake as FakeProvider).calls[1].messages!;
    expect(JSON.stringify(msgs[2])).toContain("not available");
  });
});

describe("what the gateway adds to Ask", () => {
  it("links every round under one correlation id and records a run per round", async () => {
    let n = 0;
    testDeps = makeDeps({ provider: new FakeProvider(() => (++n === 1 ? { toolUses: [{ id: "tu1", name: "funnel", input: {} }], stopReason: "tool_use" } : { text: "done", stopReason: "end_turn" })) });
    await askTheSystem("q", scope, null, "ADMIN");
    expect(testDeps.records).toHaveLength(2);
    expect(new Set(testDeps.records.map((r) => r.correlationId)).size).toBe(1);
    expect(testDeps.records[1].causationId).toBe("run-1");
    expect(testDeps.records[0]).toMatchObject({ purposeId: "ask.intelligence", agentKey: "intelligence_ask" });
  });
  it("an email typed into the question never reaches the model", async () => {
    testDeps = makeDeps({ provider: new FakeProvider({ text: "ok", stopReason: "end_turn" }) });
    await askTheSystem("what about riya@example.com", scope, null, "ADMIN");
    expect(JSON.stringify((testDeps.fake as FakeProvider).calls[0].messages)).not.toContain("riya@example.com");
  });
  it("when the gateway refuses, the user gets a plain message", async () => {
    testDeps = makeDeps({ env: { AI_KILL_SWITCH: "1" } });
    await expect(askTheSystem("q", scope, null, "ADMIN")).rejects.toThrow(/switched off/);
  });
});
