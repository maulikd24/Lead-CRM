import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gateway = vi.hoisted(() => ({ callModel: vi.fn() }));
vi.mock("@/lib/ai/gateway", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/ai/gateway")>()), callModel: gateway.callModel }));

import { aiTalkingPointsAvailable, parseTalkingPointReply, resetTalkingPointCache, respectsBlockedClasses, respectsSalesBlock, rewriteTalkingPoints } from "./talking-points-ai";

describe("parseTalkingPointReply", () => {
  it("accepts a JSON array of two or three strings, fenced or not", () => {
    expect(parseTalkingPointReply('["One point", "Two point"]')).toEqual(["One point", "Two point"]);
    expect(parseTalkingPointReply('```json\n["A", "B", "C"]\n```')).toEqual(["A", "B", "C"]);
  });

  it("rejects anything else", () => {
    expect(parseTalkingPointReply("not json")).toBeNull();
    expect(parseTalkingPointReply('["only one"]')).toBeNull();
    expect(parseTalkingPointReply('["a", "b", "c", "d"]')).toBeNull();
    expect(parseTalkingPointReply('["ok", ""]')).toBeNull();
    expect(parseTalkingPointReply('["ok", 3]')).toBeNull();
    expect(parseTalkingPointReply(JSON.stringify(["ok", "x".repeat(201)]))).toBeNull();
  });
});

describe("respectsBlockedClasses", () => {
  it("fails a reply that mentions a blocked asset class, in any case", () => {
    expect(respectsBlockedClasses(["Talk about pms fees", "Ask about goals"], ["PMS"])).toBe(false);
    expect(respectsBlockedClasses(["Ask about goals", "Review cash"], ["PMS"])).toBe(true);
  });
});

describe("rewriteTalkingPoints without a provider key", () => {
  it("returns null, so the deterministic points are kept", async () => {
    const saved = { a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(aiTalkingPointsAvailable()).toBe(false);
      expect(await rewriteTalkingPoints({ clientId: "c1", points: ["a", "b"], facts: [], blockedClasses: [] })).toBeNull();
    } finally {
      if (saved.a !== undefined) process.env.ANTHROPIC_API_KEY = saved.a;
      if (saved.o !== undefined) process.env.OPENAI_API_KEY = saved.o;
    }
  });
});

describe("respectsBlockedClasses: stems and aliases, not only the class name", () => {
  it("catches a phrasing variant such as 'mutual fund options' and 'bonds'", () => {
    expect(respectsBlockedClasses(["Discuss mutual fund options", "Ask about goals"], ["Mutual Funds"])).toBe(false);
    expect(respectsBlockedClasses(["Mention bonds for stability"], ["Bonds"])).toBe(false);
    expect(respectsBlockedClasses(["Ask about goals", "Review cash"], ["Mutual Funds"])).toBe(true);
  });
});

describe("respectsSalesBlock", () => {
  it("with a class in do-not-discuss, rejects sales vocabulary; without one, allows it", () => {
    expect(respectsSalesBlock(["Explore a new offer", "Ask about goals"], ["PMS: said not interested on 2026-10-01; do not repeat the pitch"])).toBe(false);
    expect(respectsSalesBlock(["Ask about goals", "Review cash"], ["PMS: said not interested on 2026-10-01; do not repeat the pitch"])).toBe(true);
    expect(respectsSalesBlock(["Explore a new offer"], [])).toBe(true);
  });
});

describe("rewriteTalkingPoints guards and fallbacks", () => {
  const saved = { a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY };
  const okReply = (text: string) => ({ kind: "ok", text, toolUses: [], blocks: [], stopReason: "end_turn" });
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.OPENAI_API_KEY;
    gateway.callModel.mockReset();
    resetTalkingPointCache();
  });
  afterEach(() => {
    if (saved.a === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.a;
    if (saved.o !== undefined) process.env.OPENAI_API_KEY = saved.o;
  });
  const base = { clientId: "c-open-complaint", points: ["Ask about goals", "Agree the next step"], facts: ["Lifecycle stage: Active"], blockedClasses: [] as string[] };

  it("an open complaint on the card is never sent to the model, so no rewrite can reintroduce a pitch", async () => {
    const out = await rewriteTalkingPoints({ ...base, doNotDiscuss: ["Open complaint: resolve it before any sales conversation", "PMS: said not interested on 2026-10-01; do not repeat the pitch"] });
    expect(out).toBeNull();
    expect(gateway.callModel).not.toHaveBeenCalled();
  });

  it("with a class-only do-not-discuss list, the model gets it as a hard constraint and a sales-worded reply is rejected", async () => {
    gateway.callModel.mockResolvedValueOnce(okReply('["Explore the PMS offer", "Ask about goals"]'));
    const out = await rewriteTalkingPoints({ ...base, doNotDiscuss: ["PMS: said not interested on 2026-10-01; do not repeat the pitch"] });
    expect(out).toBeNull();
    const sent = JSON.parse(gateway.callModel.mock.calls[0][0].user);
    expect(sent.doNotDiscuss).toEqual(["PMS: said not interested on 2026-10-01; do not repeat the pitch"]);
    expect(gateway.callModel.mock.calls[0][0].system).toMatch(/never mention or suggest anything in doNotDiscuss/);
  });

  it("a clean reply is accepted and cached for the client and points hash for the day", async () => {
    gateway.callModel.mockResolvedValue(okReply('["Ask what changed", "Agree the next step"]'));
    const now = new Date("2026-10-13T06:00:00Z");
    const first = await rewriteTalkingPoints({ ...base, doNotDiscuss: [], now });
    const second = await rewriteTalkingPoints({ ...base, doNotDiscuss: [], now });
    expect(first).toEqual(["Ask what changed", "Agree the next step"]);
    expect(second).toEqual(first);
    expect(gateway.callModel).toHaveBeenCalledTimes(1);
    await rewriteTalkingPoints({ ...base, doNotDiscuss: [], now: new Date("2026-10-14T06:00:00Z") });
    expect(gateway.callModel).toHaveBeenCalledTimes(2);
  });

  it("a timeout falls back to null, so the template points are kept", async () => {
    gateway.callModel.mockReturnValueOnce(new Promise(() => {}));
    const out = await rewriteTalkingPoints({ ...base, doNotDiscuss: [], timeoutMs: 20 });
    expect(out).toBeNull();
  });

  it("the model is asked once: the purpose has one attempt and a short ceiling", async () => {
    const { PURPOSES } = await import("@/lib/ai/gateway/purposes");
    const purpose = PURPOSES.find((p) => p.id === "rm.talking_points")!;
    expect(purpose.maxAttempts).toBe(1);
    expect(purpose.timeoutMs).toBeLessThanOrEqual(8_000);
  });
});
