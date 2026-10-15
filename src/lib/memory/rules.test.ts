import { describe, expect, it } from "vitest";

import { MemoryClass, MemoryConfidence, MemoryConfirmation } from "@/generated/prisma/client";

import {
  CLASS_FRESHNESS_DAYS,
  MEMORY_CLASSES,
  MEMORY_CONFIDENCES,
  MEMORY_CONFIRMATIONS,
  buildItemDefaults,
  deriveConfidence,
  effectOf,
  independentlySupported,
  initialConfirmation,
  isAiSource,
  planWrite,
  resolvedState,
  sameValue,
  transition,
  validateProposal,
  type ExistingItem,
  type Proposal,
} from "./rules";

const NOW = new Date("2027-06-30T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const ev = (ref: string, summary = "said they prefer WhatsApp") => ({ sourceRef: ref, summary, observedAt: daysAgo(2) });

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  class: "PREFERENCE",
  key: "preference:channel",
  value: { channel: "whatsapp" },
  sourceType: "conversation_ai",
  sourceRef: "insight:i1",
  evidence: [ev("insight:i1")],
  observedAt: daysAgo(2),
  ...over,
});

const existing = (over: Partial<ExistingItem> = {}): ExistingItem => ({
  id: "m1",
  class: "PREFERENCE",
  key: "preference:channel",
  value: { channel: "call" },
  sourceType: "rm_entry",
  sourceRef: "user:u1",
  evidence: [ev("user:u1")],
  confidence: "HIGH",
  observedAt: daysAgo(10),
  freshUntil: daysAhead(100),
  confirmation: "CONFIRMED",
  dataClass: "PERSONAL",
  consentBasis: null,
  createdAt: daysAgo(10),
  rejectedAt: null,
  supersededById: null,
  conflictsWithId: null,
  ...over,
});

describe("vocabulary matches the schema", () => {
  it("classes, confirmations and confidences are exactly the Prisma enums", () => {
    expect([...MEMORY_CLASSES].sort()).toEqual(Object.values(MemoryClass).sort());
    expect([...MEMORY_CONFIRMATIONS].sort()).toEqual(Object.values(MemoryConfirmation).sort());
    expect([...MEMORY_CONFIDENCES].sort()).toEqual(Object.values(MemoryConfidence).sort());
  });
  it("has the six confirmation states the brief names", () => {
    expect([...MEMORY_CONFIRMATIONS].sort()).toEqual(["CONFIRMED", "DISPUTED", "EXPIRED", "REJECTED", "SUPERSEDED", "UNCONFIRMED"]);
  });
});

describe("R1: AI-derived items are born unconfirmed and never promote themselves", () => {
  it("an AI source is UNCONFIRMED for every class, whatever else is asked", () => {
    for (const cls of MEMORY_CLASSES) for (const src of ["conversation_ai", "call_ai"] as const) expect(initialConfirmation(src, cls), `${src}/${cls}`).toBe("UNCONFIRMED");
  });
  it("a human or system-of-record source is CONFIRMED, except sentiment, which is derived and never confirmed", () => {
    for (const src of ["ledger", "system", "rm_entry", "document", "customer_stated"] as const) {
      expect(initialConfirmation(src, "FACT")).toBe("CONFIRMED");
      expect(initialConfirmation(src, "SENTIMENT")).toBe("UNCONFIRMED");
    }
  });
  it("an import is unconfirmed unless a human asserted it", () => {
    expect(initialConfirmation("import", "FACT")).toBe("UNCONFIRMED");
  });
  it("buildItemDefaults refuses to hand an AI item a confirmed state or high confidence", () => {
    const d = buildItemDefaults(proposal({ evidence: [ev("insight:i1"), ev("insight:i2")] }), NOW);
    expect(d.confirmation).toBe("UNCONFIRMED");
    expect(d.confidence).not.toBe("HIGH");
  });
  it("isAiSource", () => {
    expect(isAiSource("conversation_ai")).toBe(true);
    expect(isAiSource("call_ai")).toBe(true);
    expect(isAiSource("rm_entry")).toBe(false);
  });
});

describe("R2: no evidence, no item", () => {
  it("rejects a proposal with no evidence", () => {
    expect(validateProposal(proposal({ evidence: [] }))).toEqual({ ok: false, code: "NO_EVIDENCE", message: expect.any(String) });
  });
  it("rejects a proposal whose source ref is empty or malformed", () => {
    expect(validateProposal(proposal({ sourceRef: "" }))).toMatchObject({ ok: false, code: "NO_SOURCE_REF" });
    expect(validateProposal(proposal({ sourceRef: "whatever" }))).toMatchObject({ ok: false, code: "NO_SOURCE_REF" });
  });
  it("rejects evidence entries without a ref or a summary", () => {
    expect(validateProposal(proposal({ evidence: [{ sourceRef: "", summary: "x", observedAt: NOW }] }))).toMatchObject({ ok: false, code: "NO_EVIDENCE" });
    expect(validateProposal(proposal({ evidence: [{ sourceRef: "insight:i1", summary: "  ", observedAt: NOW }] }))).toMatchObject({ ok: false, code: "NO_EVIDENCE" });
  });
  it("accepts a well-formed AI proposal", () => {
    expect(validateProposal(proposal())).toEqual({ ok: true });
  });
  it("refuses an evidence summary that looks like a raw transcript dump", () => {
    expect(validateProposal(proposal({ evidence: [ev("insight:i1", "x".repeat(600))] }))).toMatchObject({ ok: false, code: "EVIDENCE_TOO_LONG" });
  });
});

describe("R5: no sensitive inference", () => {
  it.each([
    ["health", { class: "FACT" as const, key: "fact:health", value: { text: "has diabetes" } }],
    ["religion", { class: "FACT" as const, key: "fact:religion", value: { text: "is Hindu" } }],
    ["caste", { class: "FACT" as const, key: "fact:caste", value: { text: "belongs to a scheduled caste" } }],
    ["orientation", { class: "FACT" as const, key: "fact:note", value: { text: "is gay" } }],
    ["politics", { class: "FACT" as const, key: "fact:politics", value: { text: "votes for a party" } }],
    ["vulnerability", { class: "FACT" as const, key: "fact:vulnerable", value: { text: "vulnerable customer" } }],
  ])("an AI item about %s is refused", (_n, over) => {
    expect(validateProposal(proposal(over))).toMatchObject({ ok: false, code: "SENSITIVE_TOPIC" });
  });
  it("a human entry about religion or health is refused too (we do not record it)", () => {
    expect(validateProposal(proposal({ sourceType: "rm_entry", sourceRef: "user:u1", class: "FACT", key: "fact:religion", value: { text: "is Muslim" } }))).toMatchObject({ ok: false, code: "SENSITIVE_TOPIC" });
  });
  it("a vulnerability flag is allowed from an RM only, and is stored as sensitive", () => {
    const rm = proposal({ sourceType: "rm_entry", sourceRef: "user:u1", class: "FACT", key: "fact:vulnerable", value: { text: "vulnerable customer, bereavement" } });
    expect(validateProposal(rm)).toEqual({ ok: true });
    expect(buildItemDefaults(rm, NOW).dataClass).toBe("SENSITIVE_PERSONAL");
    expect(validateProposal({ ...rm, sourceType: "call_ai", sourceRef: "review:r1" })).toMatchObject({ ok: false, code: "SENSITIVE_TOPIC" });
  });
  it("ordinary words are not caught (no false alarm on a harmless sentence)", () => {
    expect(validateProposal(proposal({ class: "OBJECTION", key: "objection:fees", value: { text: "thinks fees are high and wants to wait" } }))).toEqual({ ok: true });
  });
});

describe("R6: consent basis", () => {
  it("chat-derived items need AI_PROCESSING_OF_CHATS and call-derived items need CALL_RECORDING, recorded on the item", () => {
    expect(buildItemDefaults(proposal({ sourceType: "conversation_ai" }), NOW).consentBasis).toBe("AI_PROCESSING_OF_CHATS");
    expect(buildItemDefaults(proposal({ sourceType: "call_ai", sourceRef: "review:r1" }), NOW).consentBasis).toBe("CALL_RECORDING");
    expect(buildItemDefaults(proposal({ sourceType: "rm_entry", sourceRef: "user:u1" }), NOW).consentBasis).toBeNull();
  });
});

describe("confidence is a rule, not a guess", () => {
  it("system-of-record and human-entered are high", () => {
    for (const src of ["ledger", "system", "rm_entry", "document"] as const) expect(deriveConfidence({ sourceType: src, evidence: [ev("a:1")], quoteVerified: false })).toBe("HIGH");
  });
  it("AI with two separate occurrences, or one quote-verified statement, is medium; otherwise low; never high", () => {
    expect(deriveConfidence({ sourceType: "conversation_ai", evidence: [ev("insight:1"), ev("insight:2")], quoteVerified: false })).toBe("MEDIUM");
    expect(deriveConfidence({ sourceType: "conversation_ai", evidence: [ev("insight:1")], quoteVerified: true })).toBe("MEDIUM");
    expect(deriveConfidence({ sourceType: "conversation_ai", evidence: [ev("insight:1")], quoteVerified: false })).toBe("LOW");
    expect(deriveConfidence({ sourceType: "call_ai", evidence: [ev("review:1"), ev("review:2"), ev("review:3")], quoteVerified: true })).toBe("MEDIUM");
  });
  it("two evidence entries from the SAME source count once", () => {
    expect(deriveConfidence({ sourceType: "conversation_ai", evidence: [ev("insight:1"), ev("insight:1")], quoteVerified: false })).toBe("LOW");
  });
  it("sentiment is always low, even if stated", () => {
    expect(buildItemDefaults(proposal({ class: "SENTIMENT", key: "sentiment:recent", value: { tone: "annoyed" } }), NOW).confidence).toBe("LOW");
  });
  it("customer-stated is medium", () => {
    expect(deriveConfidence({ sourceType: "customer_stated", evidence: [ev("activity:1")], quoteVerified: false })).toBe("MEDIUM");
  });
});

describe("R4: freshness defaults per class", () => {
  it("uses the spec's windows", () => {
    expect(CLASS_FRESHNESS_DAYS).toMatchObject({ FACT: 365, PREFERENCE: 180, INTEREST: 60, OBJECTION: 60, SENTIMENT: 30, PRODUCT_STANCE: 30 });
  });
  it("freshUntil is observedAt plus the class window", () => {
    const d = buildItemDefaults(proposal({ class: "INTEREST", key: "interest:PMS", value: { assetClass: "PMS" }, observedAt: daysAgo(10) }), NOW);
    expect(d.freshUntil?.getTime()).toBe(daysAgo(10).getTime() + 60 * 86_400_000);
  });
  it("a commitment is fresh until its due date; goals and do-not-do have no default expiry", () => {
    const due = daysAhead(5);
    expect(buildItemDefaults(proposal({ class: "COMMITMENT", key: "commitment:statement", value: { text: "send statement" }, dueAt: due }), NOW).freshUntil?.getTime()).toBe(due.getTime());
    expect(buildItemDefaults(proposal({ class: "DO_NOT_DO", key: "do_not_do:call_before_11", value: { rule: "no calls before 11" }, sourceType: "rm_entry", sourceRef: "user:u1" }), NOW).freshUntil).toBeNull();
    expect(buildItemDefaults(proposal({ class: "GOAL", key: "goal:retirement", value: { year: 2045 }, sourceType: "document", sourceRef: "goal:g1" }), NOW).freshUntil).toBeNull();
  });
  it("an explicit expiry overrides the default", () => {
    const x = daysAhead(400);
    expect(buildItemDefaults(proposal({ freshUntil: x }), NOW).freshUntil).toEqual(x);
  });
  it("a past-due freshness makes the resolved state EXPIRED, whatever the stored state", () => {
    for (const confirmation of ["UNCONFIRMED", "CONFIRMED", "DISPUTED"] as const) {
      expect(resolvedState(existing({ confirmation, freshUntil: daysAgo(1) }), NOW)).toBe("EXPIRED");
    }
    expect(resolvedState(existing({ confirmation: "REJECTED", freshUntil: daysAgo(1) }), NOW)).toBe("REJECTED");
    expect(resolvedState(existing({ confirmation: "CONFIRMED", freshUntil: daysAhead(1) }), NOW)).toBe("CONFIRMED");
    expect(resolvedState(existing({ confirmation: "CONFIRMED", freshUntil: null }), NOW)).toBe("CONFIRMED");
  });
});

describe("conflicts: a new item that disagrees is DISPUTED and never overwrites", () => {
  it("same key, same value: reaffirm the existing item, add evidence, no duplicate", () => {
    const plan = planWrite(proposal({ value: { channel: "call" } }), [existing()], NOW);
    expect(plan).toMatchObject({ kind: "reaffirm", itemId: "m1" });
  });
  it("same value in a different spelling or key order is still the same value", () => {
    expect(sameValue({ a: 1, b: "Call " }, { b: "call", a: 1 })).toBe(true);
    expect(sameValue({ channel: "call" }, { channel: "whatsapp" })).toBe(false);
  });
  it("different value against a CONFIRMED item from an AI source: the AI item is stored DISPUTED, the confirmed item is untouched", () => {
    const plan = planWrite(proposal(), [existing()], NOW);
    expect(plan).toMatchObject({ kind: "create", confirmation: "DISPUTED", conflictsWithId: "m1", disputeExistingIds: [] });
  });
  it("different value against an UNCONFIRMED item: both become DISPUTED (neither is trusted)", () => {
    const plan = planWrite(proposal(), [existing({ confirmation: "UNCONFIRMED", sourceType: "conversation_ai", confidence: "LOW" })], NOW);
    expect(plan).toMatchObject({ kind: "create", confirmation: "DISPUTED", conflictsWithId: "m1", disputeExistingIds: ["m1"] });
  });
  it("a human entry that disagrees with a CONFIRMED item: both DISPUTED until a person resolves it", () => {
    const plan = planWrite(proposal({ sourceType: "rm_entry", sourceRef: "user:u2" }), [existing()], NOW);
    expect(plan).toMatchObject({ kind: "create", confirmation: "DISPUTED", disputeExistingIds: ["m1"] });
  });
  it("never silently overwrites: no plan ever asks to change the value of an existing item", () => {
    const plans = [
      planWrite(proposal(), [existing()], NOW),
      planWrite(proposal(), [existing({ confirmation: "UNCONFIRMED" })], NOW),
      planWrite(proposal({ sourceType: "rm_entry", sourceRef: "user:u2" }), [existing()], NOW),
    ];
    for (const p of plans) expect(JSON.stringify(p)).not.toMatch(/overwrite|replaceValue|newValue/);
  });
  it("a new item that conflicts with a DISPUTED pair joins the dispute", () => {
    const plan = planWrite(proposal({ value: { channel: "sms" } }), [existing({ id: "a", confirmation: "DISPUTED" }), existing({ id: "b", confirmation: "DISPUTED", value: { channel: "whatsapp" } })], NOW);
    expect(plan).toMatchObject({ kind: "create", confirmation: "DISPUTED" });
  });
  it("REJECTED, EXPIRED and SUPERSEDED items are not conflicts", () => {
    for (const confirmation of ["REJECTED", "EXPIRED", "SUPERSEDED"] as const) {
      const plan = planWrite(proposal(), [existing({ confirmation, rejectedAt: confirmation === "REJECTED" ? daysAgo(200) : null })], NOW);
      expect(plan, confirmation).toMatchObject({ kind: "create", confirmation: "UNCONFIRMED" });
    }
  });
  it("a stale (past freshUntil) item is not a conflict either", () => {
    expect(planWrite(proposal(), [existing({ freshUntil: daysAgo(1) })], NOW)).toMatchObject({ kind: "create", confirmation: "UNCONFIRMED" });
  });
  it("a different key never conflicts", () => {
    expect(planWrite(proposal(), [existing({ key: "preference:language" })], NOW)).toMatchObject({ kind: "create", confirmation: "UNCONFIRMED" });
  });
});

describe("R7: a rejected item is not re-derived for 90 days", () => {
  it("suppresses an AI proposal for the same key and value after a rejection inside 90 days", () => {
    const plan = planWrite(proposal({ value: { channel: "call" } }), [existing({ confirmation: "REJECTED", rejectedAt: daysAgo(30), sourceType: "conversation_ai" })], NOW);
    expect(plan).toMatchObject({ kind: "suppress", reason: "REJECTED_RECENTLY" });
  });
  it("allows it again after 90 days", () => {
    const plan = planWrite(proposal({ value: { channel: "call" } }), [existing({ confirmation: "REJECTED", rejectedAt: daysAgo(95), sourceType: "conversation_ai" })], NOW);
    expect(plan.kind).toBe("create");
  });
  it("does not suppress a human entry (a person may overrule an earlier rejection)", () => {
    const plan = planWrite(proposal({ sourceType: "rm_entry", sourceRef: "user:u1", value: { channel: "call" } }), [existing({ confirmation: "REJECTED", rejectedAt: daysAgo(30) })], NOW);
    expect(plan.kind).toBe("create");
  });
  it("a rejection of a different value does not block a different proposal", () => {
    const plan = planWrite(proposal({ value: { channel: "sms" } }), [existing({ confirmation: "REJECTED", rejectedAt: daysAgo(30) })], NOW);
    expect(plan.kind).toBe("create");
  });
});

describe("R3: what each state may influence", () => {
  it("CONFIRMED and fresh is authoritative", () => expect(effectOf(existing(), NOW)).toBe("authoritative"));
  it("UNCONFIRMED and fresh is advisory only: it may downrank or prompt a question, never block or drive", () =>
    expect(effectOf(existing({ confirmation: "UNCONFIRMED" }), NOW)).toBe("advisory"));
  it("DISPUTED has no effect: neither side is used", () => expect(effectOf(existing({ confirmation: "DISPUTED" }), NOW)).toBe("none"));
  it("DISPUTED do-not-do keeps blocking (when in doubt, do not)", () =>
    expect(effectOf(existing({ class: "DO_NOT_DO", key: "do_not_do:call", confirmation: "DISPUTED" }), NOW)).toBe("authoritative"));
  it("an UNCONFIRMED do-not-do is only advisory (an AI inference cannot silence a customer)", () =>
    expect(effectOf(existing({ class: "DO_NOT_DO", key: "do_not_do:call", confirmation: "UNCONFIRMED", sourceType: "conversation_ai" }), NOW)).toBe("advisory"));
  it("REJECTED, EXPIRED, SUPERSEDED and past-due items have no effect", () => {
    for (const confirmation of ["REJECTED", "EXPIRED", "SUPERSEDED"] as const) expect(effectOf(existing({ confirmation }), NOW)).toBe("none");
    expect(effectOf(existing({ freshUntil: daysAgo(1) }), NOW)).toBe("none");
  });
});

describe("human actions: confirm, reject, dispute, edit", () => {
  const ai = existing({ confirmation: "UNCONFIRMED", sourceType: "conversation_ai", confidence: "MEDIUM", consentBasis: "AI_PROCESSING_OF_CHATS" });

  it("confirm moves UNCONFIRMED or DISPUTED to CONFIRMED with who and when, and raises confidence to high", () => {
    const r = transition(ai, { type: "confirm", actorId: "u1" }, NOW);
    expect(r).toMatchObject({ ok: true, patch: { confirmation: "CONFIRMED", confirmedById: "u1", confidence: "HIGH" } });
    expect(transition(existing({ confirmation: "DISPUTED" }), { type: "confirm", actorId: "u1" }, NOW)).toMatchObject({ ok: true });
  });
  it("confirm needs a person: an empty actor or a system actor is refused", () => {
    expect(transition(ai, { type: "confirm", actorId: "" }, NOW)).toMatchObject({ ok: false, code: "ACTOR_REQUIRED" });
    expect(transition(ai, { type: "confirm", actorId: "system" }, NOW)).toMatchObject({ ok: false, code: "ACTOR_REQUIRED" });
  });
  it("sentiment cannot be confirmed", () => {
    expect(transition(existing({ class: "SENTIMENT", confirmation: "UNCONFIRMED" }), { type: "confirm", actorId: "u1" }, NOW)).toMatchObject({ ok: false, code: "NOT_CONFIRMABLE" });
  });
  it("an expired, rejected or superseded item cannot be confirmed", () => {
    for (const confirmation of ["EXPIRED", "REJECTED", "SUPERSEDED"] as const) expect(transition(existing({ confirmation }), { type: "confirm", actorId: "u1" }, NOW), confirmation).toMatchObject({ ok: false, code: "BAD_STATE" });
    expect(transition(existing({ confirmation: "UNCONFIRMED", freshUntil: daysAgo(1) }), { type: "confirm", actorId: "u1" }, NOW)).toMatchObject({ ok: false, code: "BAD_STATE" });
  });
  it("reject needs a reason and records who", () => {
    expect(transition(ai, { type: "reject", actorId: "u1", reason: "" }, NOW)).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    expect(transition(ai, { type: "reject", actorId: "u1", reason: "Customer never said that" }, NOW)).toMatchObject({ ok: true, patch: { confirmation: "REJECTED", rejectedById: "u1", rejectedReason: "Customer never said that" } });
  });
  it("dispute needs a reason; a CONFIRMED item can be disputed by a person, and its effect then pauses", () => {
    expect(transition(existing(), { type: "dispute", actorId: "u1", reason: " " }, NOW)).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    const r = transition(existing(), { type: "dispute", actorId: "u1", reason: "Customer changed their mind" }, NOW);
    expect(r).toMatchObject({ ok: true, patch: { confirmation: "DISPUTED", disputedById: "u1", disputedReason: "Customer changed their mind" } });
  });
  it("an item that is already REJECTED, EXPIRED or SUPERSEDED cannot be disputed or rejected again", () => {
    for (const confirmation of ["REJECTED", "EXPIRED", "SUPERSEDED"] as const) {
      expect(transition(existing({ confirmation }), { type: "dispute", actorId: "u1", reason: "x" }, NOW), confirmation).toMatchObject({ ok: false, code: "BAD_STATE" });
      expect(transition(existing({ confirmation }), { type: "reject", actorId: "u1", reason: "x" }, NOW), confirmation).toMatchObject({ ok: false, code: "BAD_STATE" });
    }
  });
});

describe("R6: what survives a consent withdrawal", () => {
  it("an AI-derived item with only AI evidence is not independently supported", () => {
    expect(independentlySupported({ sourceType: "conversation_ai", evidence: [ev("insight:i1")] })).toBe(false);
  });
  it("an RM's own note or a document backing the item makes it independently supported", () => {
    expect(independentlySupported({ sourceType: "conversation_ai", evidence: [ev("insight:i1"), ev("user:u1", "Confirmed by the RM: customer told me in the branch")] })).toBe(true);
    expect(independentlySupported({ sourceType: "conversation_ai", evidence: [ev("insight:i1"), ev("document:d1", "Signed form")] })).toBe(true);
  });
  it("a human or system source is independent by itself", () => {
    expect(independentlySupported({ sourceType: "rm_entry", evidence: [ev("user:u1")] })).toBe(true);
    expect(independentlySupported({ sourceType: "ledger", evidence: [ev("consent:c1")] })).toBe(true);
  });
});
