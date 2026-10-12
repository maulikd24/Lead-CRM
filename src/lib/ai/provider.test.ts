import { describe, expect, it } from "vitest";
import { FakeProvider, getProvider } from "./provider";

describe("provider", () => {
  it("defaults to anthropic without calling the API", () => {
    expect(getProvider({} as NodeJS.ProcessEnv).name).toBe("anthropic");
  });
  it("rejects unknown providers", () => {
    expect(() => getProvider({ AI_PROVIDER: "mystery" } as unknown as NodeJS.ProcessEnv)).toThrow(/Unknown AI_PROVIDER/);
  });
  it("fake provider records calls and returns canned text", async () => {
    const fake = new FakeProvider("Hello Riya");
    const res = await fake.complete({ system: "s", user: "u", maxTokens: 100 });
    expect(res.text).toBe("Hello Riya");
    expect(fake.calls).toHaveLength(1);
  });
  it("fake provider throws a canned Error", async () => {
    const fake = new FakeProvider(new Error("boom"));
    await expect(fake.complete({ system: "s", user: "u", maxTokens: 1 })).rejects.toThrow("boom");
  });
  it("fake provider accepts a per-call function reply", async () => {
    const fake = new FakeProvider((req) => (req.system.includes("judge") ? "PASS" : new Error("draft failed")));
    const judged = await fake.complete({ system: "compliance judge", user: "u", maxTokens: 1 });
    expect(judged.text).toBe("PASS");
    await expect(fake.complete({ system: "drafter", user: "u", maxTokens: 1 })).rejects.toThrow("draft failed");
    expect(fake.calls).toHaveLength(2);
  });
  it("carries a per-request timeout through to the provider", async () => {
    const fake = new FakeProvider("ok");
    await fake.complete({ system: "s", user: "u", maxTokens: 1, timeoutMs: 5000 });
    expect(fake.calls[0].timeoutMs).toBe(5000);
  });
});
