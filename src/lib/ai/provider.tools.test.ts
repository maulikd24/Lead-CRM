import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@/lib/ai/client", () => ({ getAnthropicClient: () => ({ messages: { create: (...a: unknown[]) => create(...a) } }), isAnthropicConfigured: () => true }));
const chatCreate = vi.fn();
vi.mock("@/lib/ai/openai", () => ({ getOpenAiClient: () => ({ chat: { completions: { create: (...a: unknown[]) => chatCreate(...a) } } }), isOpenAiConfigured: () => true, getSummaryModel: () => "gpt-test" }));

import { FakeProvider, createProvider, getProvider } from "./provider";

beforeEach(() => { create.mockReset(); chatCreate.mockReset(); });

describe("AnthropicProvider: tools and conversation turns", () => {
  it("maps tools, a forced tool choice and a multi-turn conversation to the vendor shape", async () => {
    create.mockResolvedValue({ content: [{ type: "tool_use", id: "t1", name: "funnel", input: { a: 1 } }], stop_reason: "tool_use", usage: { input_tokens: 11, output_tokens: 7 } });
    const p = createProvider("anthropic", "claude-x");
    const res = await p.complete({
      system: "sys", user: "", maxTokens: 50, maxRetries: 0, timeoutMs: 5000,
      tools: [{ name: "funnel", description: "d", inputSchema: { type: "object", properties: {} } }],
      toolChoice: { name: "funnel" },
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", content: [{ type: "tool_use", id: "t0", name: "funnel", input: {} }] },
        { role: "user", content: [{ type: "tool_result", toolUseId: "t0", content: "{}", isError: true }] },
      ],
    });
    const [body, opts] = create.mock.calls[0];
    expect(body).toMatchObject({ model: "claude-x", max_tokens: 50, system: "sys", tool_choice: { type: "tool", name: "funnel" } });
    expect(body.tools).toEqual([{ name: "funnel", description: "d", input_schema: { type: "object", properties: {} } }]);
    expect(body.messages[2].content[0]).toEqual({ type: "tool_result", tool_use_id: "t0", content: "{}", is_error: true });
    expect(opts).toEqual({ timeout: 5000, maxRetries: 0 });
    expect(res.toolUses).toEqual([{ id: "t1", name: "funnel", input: { a: 1 } }]);
    expect(res.stopReason).toBe("tool_use");
    expect([res.inputTokens, res.outputTokens]).toEqual([11, 7]);
  });
  it("keeps the old defaults: plain user turn, no system key when empty, timeout 60s, one retry", async () => {
    create.mockResolvedValue({ content: [{ type: "text", text: "hi" }], usage: { input_tokens: 1, output_tokens: 1 } });
    await createProvider("anthropic", "claude-x").complete({ system: "", user: "u", maxTokens: 9 });
    const [body, opts] = create.mock.calls[0];
    expect(body).toEqual({ model: "claude-x", max_tokens: 9, messages: [{ role: "user", content: "u" }] });
    expect(opts).toEqual({ timeout: 60_000, maxRetries: 1 });
  });
});

describe("OpenAiProvider and the switch", () => {
  it("sends system and user, returns text and usage", async () => {
    chatCreate.mockResolvedValue({ choices: [{ message: { content: " out " } }], usage: { prompt_tokens: 5, completion_tokens: 3 } });
    const res = await createProvider("openai", "gpt-test").complete({ system: "s", user: "u", maxTokens: 100 });
    expect(chatCreate.mock.calls[0][0]).toMatchObject({ model: "gpt-test", messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }], max_completion_tokens: 100 });
    expect(res).toMatchObject({ text: " out ", inputTokens: 5, outputTokens: 3, model: "gpt-test" });
  });
  it("refuses tools on the openai provider rather than ignoring them", async () => {
    await expect(createProvider("openai", "m").complete({ system: "", user: "u", maxTokens: 1, tools: [{ name: "t", description: "", inputSchema: {} }] })).rejects.toThrow(/tools/i);
  });
  it("getProvider follows AI_PROVIDER and keeps rejecting unknown names", () => {
    expect(getProvider({ AI_PROVIDER: "openai" } as never).name).toBe("openai");
    expect(getProvider({ AI_PROVIDER: "fake" } as never).name).toBe("fake");
    expect(() => getProvider({ AI_PROVIDER: "mystery" } as never)).toThrow(/Unknown AI_PROVIDER/);
  });
});

describe("FakeProvider is deterministic and offline", () => {
  it("returns structured replies (tool use, usage) and records the request", async () => {
    const fake = new FakeProvider({ text: "", toolUses: [{ id: "1", name: "x", input: { k: 1 } }], stopReason: "tool_use", inputTokens: 10, outputTokens: 4 });
    const res = await fake.complete({ system: "", user: "u", maxTokens: 1 });
    expect(res).toMatchObject({ toolUses: [{ id: "1", name: "x", input: { k: 1 } }], stopReason: "tool_use", inputTokens: 10, outputTokens: 4 });
    expect(fake.calls).toHaveLength(1);
  });
  it("the demo provider (AI_PROVIDER=fake) answers the same way twice and counts tokens from length", async () => {
    const p = getProvider({ AI_PROVIDER: "fake" } as never);
    const a = await p.complete({ system: "s", user: "hello there", maxTokens: 50 });
    const b = await p.complete({ system: "s", user: "hello there", maxTokens: 50 });
    expect(a).toEqual(b);
    expect(a.inputTokens).toBeGreaterThan(0);
  });
});
