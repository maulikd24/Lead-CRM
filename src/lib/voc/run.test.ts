import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { callModel } from "@/lib/ai/gateway/gateway";
import type { CallInput, GatewayResult } from "@/lib/ai/gateway/types";
import { FakeProvider } from "@/lib/ai/provider";
import { makeDeps } from "@/lib/ai/gateway/test-kit";

import { runVocTagging, VOC_PURPOSE, VOC_SYSTEM_PROMPT, type VocItem } from "./run";

const ON = { VOC_ENABLED: "1" };
// Synthetic feedback only. Identifiers below are made up.
const ITEMS: VocItem[] = [
  { id: "a", clientId: "client-1", text: "The statement came late, call me on 9876543210" },
  { id: "b", clientId: "client-2", text: "Fees went up with no notice. Reach me at lead@example.com" },
];

/** A gateway deps object whose provider replies with the given text (or runs the given function). */
function gateway(reply: string | ((u: string) => string), over: Partial<Parameters<typeof makeDeps>[0]> = {}) {
  const fake = new FakeProvider((req) => (typeof reply === "string" ? reply : reply(req.user)));
  const made = makeDeps({ ...over, provider: fake });
  return { ...made, fake, call: (input: CallInput) => callModel(input, made.deps) };
}

describe("runVocTagging: the feature flag", () => {
  it("does nothing while VOC_ENABLED is off, and calls no model", async () => {
    let calls = 0;
    const out = await runVocTagging(ITEMS, { env: {}, call: async () => { calls += 1; return { kind: "abstain", runId: null, correlationId: "c", reason: "do_not_know" }; } });
    expect(out).toEqual({ kind: "disabled" });
    expect(calls).toBe(0);
  });

  it("is off for any value other than exactly 1", async () => {
    expect((await runVocTagging(ITEMS, { env: { VOC_ENABLED: "true" } })).kind).toBe("disabled");
  });
});

describe("runVocTagging: through the gateway, with the offline fake provider", () => {
  it("tags each item through callModel under the voc.tag purpose, with the customer as subject", async () => {
    const g = gateway('{"themes":["delay"]}');
    const out = await runVocTagging(ITEMS, { env: ON, call: g.call });
    expect(out.kind).toBe("ok");
    expect(g.fake.calls).toHaveLength(2);
    expect(g.fake.calls[0].system).toBe(VOC_SYSTEM_PROMPT);
    expect(g.records[0]).toMatchObject({ purposeId: VOC_PURPOSE, status: "ok", subjectType: "client", subjectId: "client-1" });
  });

  it("masks identifiers before the text reaches the provider", async () => {
    const g = gateway('{"themes":["communication"]}');
    await runVocTagging(ITEMS, { env: ON, call: g.call });
    for (const req of g.fake.calls) {
      expect(req.user).not.toMatch(/9876543210/);
      expect(req.user).not.toMatch(/lead@example\.com/);
    }
    expect(g.fake.calls[0].user).toContain("[phone]");
    expect(g.fake.calls[1].user).toContain("[email]");
  });

  it("builds the theme summary from the tagged items", async () => {
    const g = gateway((u) => (u.includes("statement") ? '{"themes":["reports_statements","delay"]}' : '{"themes":["fees"]}'));
    const out = await runVocTagging(ITEMS, { env: ON, call: g.call });
    if (out.kind !== "ok") throw new Error("expected ok");
    expect(out.summary.themes.map((t) => [t.theme, t.count])).toEqual([["delay", 1], ["fees", 1], ["reports_statements", 1]]);
    expect(out.items.map((i) => i.kind)).toEqual(["tagged", "tagged"]);
  });

  it("abstains explicitly for an empty reply, a malformed reply and a model abstain, never a guess", async () => {
    for (const [reply, reason] of [["", "empty"], ["not json", "malformed"], ["ABSTAIN: do_not_know", "model_abstained"]] as const) {
      const g = gateway(reply);
      const out = await runVocTagging([ITEMS[0]], { env: ON, call: g.call });
      if (out.kind !== "ok") throw new Error("expected ok");
      expect(out.items[0]).toMatchObject({ kind: "abstain", reason: reason === "model_abstained" ? "model_do_not_know" : reason });
      expect(out.summary.themes).toEqual([]);
    }
  });

  it("abstains with the reason when the consent ledger denies the customer", async () => {
    const g = gateway('{"themes":["delay"]}', { consent: async () => ({ allowed: false, reason: "NO_CONSENT" }) });
    const out = await runVocTagging([ITEMS[0]], { env: ON, call: g.call });
    if (out.kind !== "ok") throw new Error("expected ok");
    expect(out.items[0]).toEqual({ id: "a", text: "The statement came late, call me on [phone]", kind: "abstain", reason: "blocked_consent_denied" });
    expect(g.fake.calls).toHaveLength(0);
  });

  it("abstains as unavailable when the provider fails, without throwing", async () => {
    const g = gateway(() => "unused");
    const failing = (input: CallInput): Promise<GatewayResult> => Promise.reject(new Error("boom")).catch(() => ({ kind: "failed", errorClass: "network", retryable: true, attempts: 1, correlationId: "c", runId: null }));
    const out = await runVocTagging([ITEMS[0]], { env: ON, call: failing });
    if (out.kind !== "ok") throw new Error("expected ok");
    expect(out.items[0]).toMatchObject({ kind: "abstain", reason: "unavailable" });
    expect(g.fake.calls).toHaveLength(0);
  });

  it("marks an empty item as an empty abstain without calling the model", async () => {
    const g = gateway('{"themes":["delay"]}');
    const out = await runVocTagging([{ id: "x", clientId: "client-3", text: "   " }], { env: ON, call: g.call });
    if (out.kind !== "ok") throw new Error("expected ok");
    expect(out.items[0]).toMatchObject({ kind: "abstain", reason: "empty" });
    expect(g.fake.calls).toHaveLength(0);
  });
});

describe("the voc module stays on the gateway", () => {
  it("imports no model SDK and no provider factory", () => {
    const dir = join(process.cwd(), "src", "lib", "voc");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/from "(@anthropic-ai\/[^"]+|openai)"/);
      expect(src, f).not.toMatch(/from "@\/lib\/ai\/provider"/);
      expect(src, f).not.toMatch(/\bnew (Anthropic|OpenAI)\b/);
    }
  });
});
