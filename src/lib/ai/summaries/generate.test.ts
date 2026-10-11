import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeProvider } from "@/lib/ai/provider";
import { makeDeps } from "@/lib/ai/gateway/test-kit";

const rows = new Map<string, { summary: string; model: string; createdAt: Date }>();
const aiSummary = {
  findUnique: vi.fn(async ({ where }: { where: { kind_subjectKey_contentHash: { contentHash: string } } }) => rows.get(where.kind_subjectKey_contentHash.contentHash) ?? null),
  count: vi.fn(async () => 0),
  upsert: vi.fn(async ({ where, create }: { where: { kind_subjectKey_contentHash: { contentHash: string } }; create: { summary: string; model: string } }) => {
    const row = { summary: create.summary, model: create.model, createdAt: new Date("2026-10-12T10:00:00Z") };
    rows.set(where.kind_subjectKey_contentHash.contentHash, row);
    return row;
  }),
};
vi.mock("@/lib/db/prisma", () => ({ prisma: { get aiSummary() { return aiSummary; } } }));

let testDeps = makeDeps();
vi.mock("@/lib/ai/gateway/wiring", () => ({ defaultGatewayDeps: () => testDeps.deps }));
vi.mock("@/lib/ai/openai", () => ({ getOpenAiClient: () => { throw new Error("the SDK must not be called directly"); }, getSummaryModel: () => "gpt-4o-mini", isOpenAiConfigured: () => Boolean(process.env.OPENAI_API_KEY) }));

import { AiNotConfiguredError, generateSummary } from "./generate";

const input = { kind: "client", subjectKey: "c1", userId: "u1", instruction: "Summarise this client.", facts: "Open tasks: 2. Next KYC step is pending." };

beforeEach(() => {
  rows.clear(); vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("OPENAI_SUMMARY_MODEL", "");
  testDeps = makeDeps({ provider: new FakeProvider({ text: "  • One\nNext: do it  ", model: "gpt-4o-mini", inputTokens: 100, outputTokens: 40 }) });
});

describe("generateSummary through the gateway: same behaviour as the direct OpenAI call", () => {
  it("sends the same system and user prompts, trims the answer, stores it and reports the model", async () => {
    const r = await generateSummary(input);
    const call = (testDeps.fake as FakeProvider).calls[0];
    expect(call.system).toMatch(/^You write brief page summaries for a wealth-management CRM/);
    expect(call.user).toBe("Summarise this client.\n\nFACTS:\nOpen tasks: 2. Next KYC step is pending.");
    expect(r).toMatchObject({ summary: "• One\nNext: do it", cached: false, model: "gpt-4o-mini" });
    expect(aiSummary.upsert).toHaveBeenCalledTimes(1);
  });
  it("still serves the cache without any model call", async () => {
    await generateSummary(input);
    const again = await generateSummary(input);
    expect(again.cached).toBe(true);
    expect((testDeps.fake as FakeProvider).calls).toHaveLength(1);
  });
  it("keeps the not-configured error when there is no OpenAI key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(generateSummary(input)).rejects.toBeInstanceOf(AiNotConfiguredError);
  });
  it("keeps the per-user hourly limit", async () => {
    aiSummary.count.mockResolvedValueOnce(30);
    await expect(generateSummary(input)).rejects.toThrow(/hourly limit/);
  });
  it("an empty answer is still an error and stores nothing", async () => {
    testDeps = makeDeps({ provider: new FakeProvider("   ") });
    await expect(generateSummary(input)).rejects.toThrow(/empty summary/);
    expect(aiSummary.upsert).not.toHaveBeenCalled();
  });
});

describe("what the gateway adds", () => {
  it("records one run for the summary purpose with no fact text in it", async () => {
    await generateSummary(input);
    expect(testDeps.records).toHaveLength(1);
    expect(testDeps.records[0]).toMatchObject({ purposeId: "summary.page", agentKey: "ai_summaries", provider: "openai", status: "ok" });
    expect(JSON.stringify(testDeps.records[0])).not.toContain("KYC step");
  });
  it("a PAN that slipped into the facts never reaches the model", async () => {
    await generateSummary({ ...input, facts: "Client PAN ABCDE1234F, mail a@b.com" });
    const sent = (testDeps.fake as FakeProvider).calls[0].user;
    expect(sent).not.toMatch(/ABCDE1234F|a@b\.com/);
  });
  it("stops with a plain message when the kill switch is on, and does not call the model", async () => {
    testDeps = makeDeps({ env: { AI_KILL_SWITCH: "1", AI_BUDGET_DEFAULT_USD: "5" } });
    await expect(generateSummary(input)).rejects.toThrow(/switched off/);
    expect((testDeps.fake as FakeProvider).calls).toHaveLength(0);
  });
  it("stops when the daily budget is spent", async () => {
    testDeps = makeDeps({ env: { AI_BUDGET_DEFAULT_USD: "1" }, spentToday: async () => 1 });
    await expect(generateSummary(input)).rejects.toThrow(/daily AI budget/);
  });
});
