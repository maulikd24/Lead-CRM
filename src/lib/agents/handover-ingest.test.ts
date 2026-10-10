import { describe, expect, it } from "vitest";
import { flagHandoverAtIngest } from "./handover-ingest";

const mk = (enabled: boolean) => {
  const calls: unknown[] = [];
  return { calls, deps: { enabled: async () => enabled, record: async (i: unknown) => { calls.push(i); } } };
};

describe("flagHandoverAtIngest", () => {
  it("does nothing, and never inspects the text, when the flags are off", async () => {
    const { calls, deps } = mk(false);
    expect(await flagHandoverAtIngest(deps, { clientId: "c1", messageId: "m1", text: "this is a fraud" })).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it("records a handover when enabled and the text trips needsHandover", async () => {
    const { calls, deps } = mk(true);
    expect(await flagHandoverAtIngest(deps, { clientId: "c1", messageId: "m1", text: "I will complain to SEBI" })).toBe(true);
    expect(calls).toEqual([{ clientId: "c1", triggerMessageId: "m1", reason: expect.stringContaining("complain") }]);
  });
  it("ignores ordinary text", async () => {
    const { calls, deps } = mk(true);
    expect(await flagHandoverAtIngest(deps, { clientId: "c1", messageId: "m1", text: "kya mera KYC ho gaya?" })).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it("never throws: a failing dependency is swallowed (ingest must not fail)", async () => {
    const deps = { enabled: async () => true, record: async () => { throw new Error("db down"); } };
    expect(await flagHandoverAtIngest(deps, { clientId: "c1", messageId: "m1", text: "fraud" })).toBe(false);
  });
});
