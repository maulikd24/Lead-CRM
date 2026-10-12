import { describe, expect, it } from "vitest";
import { FakeProvider } from "@/lib/ai/provider";
import { judgeOutbound } from "./judge";

describe("judgeOutbound", () => {
  it("passes on SAFE", async () => {
    expect(await judgeOutbound("Hi", new FakeProvider("SAFE"))).toEqual({ safe: true });
  });
  it("accepts only the bare word SAFE (case, trailing punctuation/whitespace)", async () => {
    for (const r of ["SAFE", "safe", "SAFE.", "SAFE\n", "safe."]) expect(await judgeOutbound("Hi", new FakeProvider(r)), r).toEqual({ safe: true });
  });
  // Changed deliberately (fix round 1): "SAFE - fine" used to pass; any extra text is now UNSAFE (fail closed).
  it("treats multi-line, hedged or decorated replies as unsafe", async () => {
    for (const r of ["SAFE\nUNSAFE: promises returns", "SAFE, but this implies guaranteed returns", "Safe to say this is UNSAFE", "SAFE - fine", "**SAFE**"]) {
      expect((await judgeOutbound("Hi", new FakeProvider(r))).safe, r).toBe(false);
    }
  });
  it("returns the reason on UNSAFE", async () => {
    expect(await judgeOutbound("Hi", new FakeProvider("UNSAFE: promises returns"))).toEqual({ safe: false, reason: "UNSAFE: promises returns" });
  });
  it("never passes an empty reply", async () => {
    expect(await judgeOutbound("Hi", new FakeProvider(""))).toEqual({ safe: false, reason: "judge returned no verdict" });
  });
  it("fails closed when the provider throws", async () => {
    expect(await judgeOutbound("Hi", new FakeProvider(new Error("boom")))).toEqual({ safe: false, reason: "judge unavailable" });
  });
  it("treats an unclear verdict as unsafe", async () => {
    expect((await judgeOutbound("Hi", new FakeProvider("I think this is fine"))).safe).toBe(false);
  });
  it("does not treat UNSAFE as SAFE (word boundary)", async () => {
    expect((await judgeOutbound("Hi", new FakeProvider("UNSAFE"))).safe).toBe(false);
  });
  it("sends exactly the draft and a timeout", async () => {
    const fake = new FakeProvider("SAFE");
    const text = "Please upload your PAN card";
    await judgeOutbound(text, fake);
    expect(fake.calls[0].user).toBe(text);
    expect(fake.calls[0].timeoutMs).toBeGreaterThan(0);
  });
});
