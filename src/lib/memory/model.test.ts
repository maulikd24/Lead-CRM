import { describe, expect, it } from "vitest";

import { FakeProvider } from "@/lib/ai/provider";
import { makeDeps } from "@/lib/ai/gateway/test-kit";
import { getAgent } from "@/lib/agents/registry";
import { getPurpose } from "@/lib/ai/gateway/purposes";
import { gatewayMemoryModel } from "./model";
import { refineWithModel, type InsightRow } from "./propose";

const insight = (over: Partial<InsightRow> = {}): InsightRow => ({ id: "i1", kind: "OBJECTION", assetClass: null, text: "Please do not call me after 6 pm, I prefer WhatsApp.", severity: null, dueAt: null, sourceType: "WHATSAPP_THREAD", sourceRef: "r1", occurredAt: new Date("2026-10-01T10:00:00Z"), ...over });
const reply = JSON.stringify({ items: [{ insightId: "i1", class: "PREFERENCE", key: "preference:contact_channel", value: { text: "prefers WhatsApp" }, quote: "I prefer WhatsApp" }] });

describe("memory extraction goes through callModel() (the legacy provider seam is gone)", () => {
  it("the purpose is registered, belongs to the memory_extractor agent and is gated on AI processing of chats", () => {
    const p = getPurpose("memory.extract");
    expect(p).toBeDefined();
    expect(p?.agentKey).toBe("memory_extractor");
    expect(p?.consent).toEqual({ purpose: "AI_PROCESSING_OF_CHATS", channel: null });
    expect(p?.abstainProtocol).toBe(true);
  });
  it("the agent is L3 at most (draft only): its one action proposes an internal record, a person confirms, and it never sends", () => {
    const a = getAgent("memory_extractor")!;
    expect(a.actions).toEqual([{ actionType: "propose_internal_record", defaultLevel: 3, maxLevel: 3 }]);
    expect(a.prohibitedActions).toEqual(expect.arrayContaining(["send_message", "write_consent", "delete_data"]));
    expect(a.approval.required).toBe("always");
    expect(a.purposes).toEqual(["memory.extract"]);
    expect(a.dataPermissions.consent).toBe("AI_PROCESSING_OF_CHATS");
  });

  it("an ok reply becomes proposals; the call is recorded under the purpose with the customer as subject", async () => {
    const { deps, records } = makeDeps({ provider: new FakeProvider(reply) });
    const out = await refineWithModel([insight()], gatewayMemoryModel("c1", deps));
    expect(out.status).toBe("ok");
    expect(out.proposals.map((p) => p.proposal.key)).toEqual(["preference:contact_channel"]);
    expect(records[0]).toMatchObject({ purposeId: "memory.extract", agentKey: "memory_extractor", status: "ok" });
  });
  it("consent is checked for the customer: withdrawn AI-processing consent means no call to the vendor and no proposals", async () => {
    const seen: unknown[] = [];
    const fake = new FakeProvider(reply);
    const { deps } = makeDeps({ provider: fake, consent: async (...a) => { seen.push(a); return { allowed: false, reason: "WITHDRAWN" }; } });
    const out = await refineWithModel([insight()], gatewayMemoryModel("c1", deps));
    expect(seen).toEqual([["c1", "AI_PROCESSING_OF_CHATS", null]]);
    expect(out.status).toBe("blocked");
    expect(out.proposals).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });
  it("a model that abstains is an outcome, not an error: nothing proposed, status abstained", async () => {
    const { deps } = makeDeps({ provider: new FakeProvider("ABSTAIN: do_not_know") });
    const out = await refineWithModel([insight()], gatewayMemoryModel("c1", deps));
    expect(out.status).toBe("abstained");
    expect(out.proposals).toEqual([]);
  });
  it("a provider failure or an unreadable reply yields no proposals, never an exception", async () => {
    const down = await refineWithModel([insight()], gatewayMemoryModel("c1", makeDeps({ provider: new FakeProvider(new Error("model down")) }).deps));
    expect(down.status).toBe("failed");
    const junk = await refineWithModel([insight()], gatewayMemoryModel("c1", makeDeps({ provider: new FakeProvider("not json") }).deps));
    expect(junk.status).toBe("unparseable");
    expect(junk.proposals).toEqual([]);
  });
  it("the global AI kill switch blocks it before anything is sent", async () => {
    const fake = new FakeProvider(reply);
    const { deps } = makeDeps({ provider: fake, env: { AI_KILL_SWITCH: "1", AI_BUDGET_DEFAULT_USD: "100" } });
    expect((await refineWithModel([insight()], gatewayMemoryModel("c1", deps))).status).toBe("blocked");
    expect(fake.calls).toHaveLength(0);
  });
  it("an invented quote is still refused (the quote check runs on what the model saw), and what is stored is unconfirmed by construction (the store decides; here only proposals exist)", async () => {
    const bad = JSON.stringify({ items: [{ insightId: "i1", class: "PREFERENCE", key: "preference:contact_channel", value: { text: "x" }, quote: "words that are not in the note" }] });
    const out = await refineWithModel([insight()], gatewayMemoryModel("c1", makeDeps({ provider: new FakeProvider(bad) }).deps));
    expect(out.proposals).toEqual([]);
    expect(out.rejected[0].reason).toBe("QUOTE_NOT_IN_SOURCE");
  });
});
