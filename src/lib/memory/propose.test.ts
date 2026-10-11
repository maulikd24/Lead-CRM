import { describe, expect, it } from "vitest";

import { FakeProvider } from "@/lib/ai/provider";

import { parseModelProposals, proposalsFromInsights, redact, refineWithModel, type InsightRow } from "./propose";
import { validateProposal } from "./rules";

const insight = (over: Partial<InsightRow> = {}): InsightRow => ({
  id: "i1",
  kind: "INTEREST",
  assetClass: "PMS",
  text: "Asked about PMS minimums and lock-in",
  severity: null,
  dueAt: null,
  sourceType: "WHATSAPP_THREAD",
  sourceRef: "r1",
  occurredAt: new Date("2027-06-28T10:00:00Z"),
  ...over,
});

describe("proposalsFromInsights: deterministic mapping, every item AI-derived and evidence-backed", () => {
  it("maps kinds to memory classes", () => {
    const out = proposalsFromInsights([
      insight(),
      insight({ id: "i2", kind: "DECLINED", assetClass: "AIF", text: "Said no to AIF" }),
      insight({ id: "i3", kind: "OBJECTION", assetClass: null, text: "Thinks fees are too high" }),
      insight({ id: "i4", kind: "COMMITMENT", assetClass: null, text: "RM to send the statement", dueAt: new Date("2027-07-02T00:00:00Z") }),
      insight({ id: "i5", kind: "EXTERNAL_HOLDING", assetClass: null, text: "Holds mutual funds with another broker" }),
      insight({ id: "i6", kind: "COMPLAINT", assetClass: null, text: "Unhappy about delayed withdrawal", severity: "high" }),
    ]).map((p) => [p.insightId, p.proposal.class, p.proposal.key.split(":")[0]]);
    expect(out).toEqual([
      ["i1", "INTEREST", "interest"],
      ["i2", "PRODUCT_STANCE", "product_stance"],
      ["i3", "OBJECTION", "objection"],
      ["i4", "COMMITMENT", "commitment"],
      ["i5", "FACT", "fact"],
      ["i6", "SERVICE_CONTEXT", "service_context"],
    ]);
  });
  it("skips kinds that are quality findings about the RM, not knowledge about the customer", () => {
    expect(proposalsFromInsights([insight({ kind: "COMPLIANCE_CONCERN" }), insight({ id: "x", kind: "INCORRECT_INFO" }), insight({ id: "y", kind: "MISSED_OPPORTUNITY" }), insight({ id: "z", kind: "QUESTION" })])).toEqual([]);
  });
  it("calls are call_ai, everything else conversation_ai; the source ref is the insight; the evidence points back at it", () => {
    const [call, chat] = proposalsFromInsights([insight({ sourceType: "CALL", sourceRef: "r9" }), insight({ id: "i2", assetClass: "AIF" })]);
    expect(call.proposal.sourceType).toBe("call_ai");
    expect(chat.proposal.sourceType).toBe("conversation_ai");
    expect(call.proposal.sourceRef).toBe("insight:i1");
    expect(call.proposal.evidence[0]).toMatchObject({ sourceRef: "insight:i1", via: "review:r9" });
  });
  it("every produced proposal is valid under the rules, and none claims a confirmed state", () => {
    for (const p of proposalsFromInsights([insight(), insight({ id: "i2", kind: "OBJECTION", assetClass: null })])) expect(validateProposal(p.proposal)).toEqual({ ok: true });
  });
  it("the commitment carries its due date; a missing text is skipped", () => {
    const [c] = proposalsFromInsights([insight({ kind: "COMMITMENT", assetClass: null, dueAt: new Date("2027-07-02T00:00:00Z") })]);
    expect(c.proposal.dueAt?.toISOString()).toBe("2027-07-02T00:00:00.000Z");
    expect(proposalsFromInsights([insight({ text: "  " })])).toEqual([]);
  });
  it("two objections with different wording are different keys, so they never collide into a false conflict", () => {
    const [a, b] = proposalsFromInsights([insight({ kind: "OBJECTION", assetClass: null, text: "Fees too high" }), insight({ id: "i2", kind: "OBJECTION", assetClass: null, text: "Wants to wait for the market to fall" })]);
    expect(a.proposal.key).not.toBe(b.proposal.key);
  });
  it("the same interest seen in two conversations has the same key and value, so it becomes one item with two pieces of evidence", () => {
    const [a, b] = proposalsFromInsights([insight(), insight({ id: "i2", text: "Asked about PMS again", sourceRef: "r2" })]);
    expect(a.proposal.key).toBe(b.proposal.key);
    expect(a.proposal.value).toEqual(b.proposal.value);
  });
});

describe("redact: evidence is a short redacted summary, not raw text", () => {
  it("masks long numbers, emails and PAN-shaped codes and trims to 280 characters", () => {
    expect(redact("call 9876543210 or mail a.b@example.com, PAN ABCDE1234F")).toBe("call [number] or mail [email], PAN [id]");
    expect(redact("x".repeat(500)).length).toBeLessThanOrEqual(280);
  });
});

describe("model refinement (the AI seam): strictly draft, verified against the source", () => {
  const rows = [insight({ id: "i1", kind: "OBJECTION", assetClass: null, text: "Customer said please do not call before 11 in the morning" }), insight({ id: "i2", kind: "CONCERN", assetClass: null, text: "Worried about the market" })];
  const reply = (items: unknown[]) => JSON.stringify({ items });

  it("accepts an item only when its quote is a verbatim part of that insight's text, and marks it quote-verified", async () => {
    const model = new FakeProvider(reply([{ insightId: "i1", class: "DO_NOT_DO", key: "do_not_do:call_before_11", value: { text: "No calls before 11am" }, quote: "do not call before 11 in the morning" }]));
    const out = await refineWithModel(rows, model);
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0].proposal).toMatchObject({ class: "DO_NOT_DO", sourceType: "conversation_ai", quoteVerified: true, sourceRef: "insight:i1" });
    expect(out.proposals[0].proposal.evidence[0].summary).toBe("do not call before 11 in the morning");
  });
  it("rejects an invented quote (unsupported inference never becomes an item)", async () => {
    const model = new FakeProvider(reply([{ insightId: "i1", class: "FACT", key: "fact:retired", value: { text: "retired" }, quote: "I retired last year" }]));
    const out = await refineWithModel(rows, model);
    expect(out.proposals).toEqual([]);
    expect(out.rejected[0].reason).toBe("QUOTE_NOT_IN_SOURCE");
  });
  it("rejects an item for an insight that was not sent, and sensitive topics", async () => {
    const model = new FakeProvider(reply([
      { insightId: "nope", class: "PREFERENCE", key: "preference:x", value: { text: "x" }, quote: "please do not call" },
      { insightId: "i2", class: "FACT", key: "fact:health", value: { text: "has diabetes" }, quote: "Worried about the market" },
    ]));
    const out = await refineWithModel(rows, model);
    expect(out.proposals).toEqual([]);
    expect(out.rejected.map((r) => r.reason).sort()).toEqual(["SENSITIVE_TOPIC", "UNKNOWN_INSIGHT"]);
  });
  it("garbage or a thrown error from the model yields no proposals and no crash", async () => {
    expect((await refineWithModel(rows, new FakeProvider("not json"))).proposals).toEqual([]);
    expect((await refineWithModel(rows, new FakeProvider(new Error("timeout")))).proposals).toEqual([]);
    expect(parseModelProposals("```json\n" + reply([]) + "\n```")).toEqual({ items: [] });
  });
  it("sends the insight text only: no client name, no ids of the customer", async () => {
    const model = new FakeProvider(reply([]));
    await refineWithModel(rows, model);
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0].user).toContain("do not call before 11");
    expect(model.calls[0].user).not.toMatch(/clientId|mobile|email/i);
  });
  it("makes no model call at all when there is nothing to read", async () => {
    const model = new FakeProvider(reply([]));
    expect((await refineWithModel([], model)).proposals).toEqual([]);
    expect(model.calls).toHaveLength(0);
  });
});
