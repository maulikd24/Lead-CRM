import { describe, expect, it } from "vitest";
import { aiTalkingPointsAvailable, parseTalkingPointReply, respectsBlockedClasses, rewriteTalkingPoints } from "./talking-points-ai";

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
