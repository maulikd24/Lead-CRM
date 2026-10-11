import { describe, expect, it } from "vitest";

import { emitWith, type EventStore, type NewEventRow } from "./emit";
import { eventIdFor, flowCorrelationId } from "./envelope";
import {
  buildAccountFunded, buildCallLogged, buildCampaignLeadAttributed, buildComplaintRaised, buildCustomerMerged, buildKycDecision, buildKycStarted, buildLeadAssigned, buildLeadContacted, buildLeadCreated, buildLeadLost,
  buildDecisionEvent, buildMemoryEvent, buildReferralAttributed, buildStageChanged, buildTicketCreated, buildTransactionRecorded, buildWhatsappMessage,
} from "./producers";

const NOW = new Date("2027-03-01T10:00:00Z");
function store() {
  const rows: NewEventRow[] = [];
  const s: EventStore = { async insert(r) { rows.push(r); return "inserted"; }, async recordFailure() {} };
  return { rows, s };
}
const emit = async (input: Parameters<typeof emitWith>[1] | null) => {
  expect(input).not.toBeNull();
  const { rows, s } = store();
  const out = await emitWith({ store: s, enabled: () => true, now: () => NOW }, input!);
  return { out, row: rows[0] };
};

describe("every producer builds an event the registry accepts", () => {
  const cases: [string, () => Parameters<typeof emitWith>[1] | null][] = [
    ["lead.created", () => buildLeadCreated({ clientId: "c1", leadSource: "Meta Ads", actorUserId: "u1" })],
    ["lead.assigned", () => buildLeadAssigned({ clientId: "c1", assigneeId: "u2", method: "manual", ref: "act1", actorUserId: "u1" })],
    ["lead.contacted", () => buildLeadContacted({ clientId: "c1", activityId: "a1", channel: "call", actorUserId: "u1" })],
    ["lead.lost", () => buildLeadLost({ clientId: "c1", ref: "stage1", actorUserId: "u1" })],
    ["customer.stage.changed", () => buildStageChanged({ clientId: "c1", historyId: "h1", fromStageId: "s1", toStageId: "s2", slaMet: true, actorUserId: "u1" })],
    ["account.kyc.started", () => buildKycStarted({ clientId: "c1", submittedAt: NOW, method: "online", actorUserId: "u1" })],
    ["account.kyc.verified", () => buildKycDecision({ clientId: "c1", status: "APPROVED", completedAt: NOW, actorUserId: "u1" })],
    ["account.kyc.rejected", () => buildKycDecision({ clientId: "c1", status: "REJECTED", completedAt: NOW, actorUserId: "u1" })],
    ["account.funded", () => buildAccountFunded({ clientId: "c1", status: "FULLY_FUNDED", fundingDate: NOW, actorUserId: "u1" })],
    ["transaction.recorded", () => buildTransactionRecorded({ clientId: "c1", transactionId: "t1", type: "BUY", first: true, occurredAt: NOW })],
    ["ticket.created", () => buildTicketCreated({ clientId: "c1", ticketId: "tk1", provider: "freshdesk", priority: "high", channel: "email", occurredAt: NOW })],
    ["complaint.raised", () => buildComplaintRaised({ clientId: "c1", insightId: "i1", severity: "high", via: "conversation", occurredAt: NOW })],
    ["whatsapp.message.received", () => buildWhatsappMessage({ clientId: "c1", messageId: "m1", direction: "INBOUND", hasMedia: false, origin: "customer", occurredAt: NOW })],
    ["whatsapp.message.sent", () => buildWhatsappMessage({ clientId: "c1", messageId: "m2", direction: "OUTBOUND", hasMedia: true, origin: "crm", occurredAt: NOW, senderUserId: "u1" })],
    ["call.logged", () => buildCallLogged({ clientId: "c1", callId: "k1", direction: "INCOMING", durationSeconds: 61, startedAt: NOW, userId: "u1" })],
    ["campaign.lead.attributed", () => buildCampaignLeadAttributed({ clientId: "c1", leadSource: "Meta Ads", attribution: { campaign: "spring", source: "meta_leads" } })],
    ["referral.attributed", () => buildReferralAttributed({ clientId: "c1", referralId: "r1", referrerId: "rf1", occurredAt: NOW })],
    ["customer.merged", () => buildCustomerMerged({ survivorId: "c1", duplicateId: "c2", conflicts: 2, actorUserId: "u1" })],
  ];
  it.each(cases)("%s is stored, not rejected", async (type, build) => {
    const { out, row } = await emit(build());
    expect(out.status, type).toBe("stored");
    expect(row.eventType).toBe(type);
    expect(row.clientId).toBe(type === "customer.merged" ? "c1" : "c1");
  });
});

describe("threading: one correlation id per customer flow, and causes that can be referenced", () => {
  it("every customer event of one customer shares the flow correlation id", async () => {
    const built = [buildLeadCreated({ clientId: "c9", actorUserId: null }), buildStageChanged({ clientId: "c9", historyId: "h", fromStageId: null, toStageId: "s", slaMet: null, actorUserId: "u" }), buildAccountFunded({ clientId: "c9", status: "FULLY_FUNDED", fundingDate: NOW, actorUserId: "u" })];
    for (const b of built) expect(b!.correlationId).toBe(flowCorrelationId("c9"));
  });
  it("assigned and contacted name the lead.created event as their cause, without a lookup", () => {
    const created = buildLeadCreated({ clientId: "c9", actorUserId: null });
    const causeId = eventIdFor(created.source, created.dedupeKey);
    expect(buildLeadAssigned({ clientId: "c9", assigneeId: "u", method: "round_robin", ref: "x", actorUserId: null })!.causationId).toBe(causeId);
    expect(buildLeadContacted({ clientId: "c9", activityId: "a", channel: "call", actorUserId: "u" })!.causationId).toBe(causeId);
  });
  it("a different customer has a different flow", () => expect(flowCorrelationId("c1")).not.toBe(flowCorrelationId("c2")));
});

describe("dedupe keys come from internal row ids, so a retry is idempotent and no personal identifier is ever part of a key", () => {
  it("the same row gives the same key; another row, another key", () => {
    const a = buildWhatsappMessage({ clientId: "c1", messageId: "m1", direction: "INBOUND", hasMedia: false, origin: "customer", occurredAt: NOW });
    const b = buildWhatsappMessage({ clientId: "c1", messageId: "m1", direction: "INBOUND", hasMedia: false, origin: "customer", occurredAt: NOW });
    const c = buildWhatsappMessage({ clientId: "c1", messageId: "m2", direction: "INBOUND", hasMedia: false, origin: "customer", occurredAt: NOW });
    expect(a.dedupeKey).toBe(b.dedupeKey);
    expect(a.dedupeKey).not.toBe(c.dedupeKey);
  });
  it("inbound is received and outbound is sent; a template send is a template event", () => {
    expect(buildWhatsappMessage({ clientId: "c1", messageId: "m1", direction: "INBOUND", hasMedia: false, origin: "customer", occurredAt: NOW }).type).toBe("whatsapp.message.received");
    expect(buildWhatsappMessage({ clientId: "c1", messageId: "m1", direction: "OUTBOUND", hasMedia: false, origin: "crm", occurredAt: NOW }).type).toBe("whatsapp.message.sent");
    expect(buildWhatsappMessage({ clientId: "c1", messageId: "m1", direction: "OUTBOUND", hasMedia: false, origin: "crm", occurredAt: NOW, templateId: "tpl" }).type).toBe("whatsapp.template.sent");
  });
  it("an actor is a user id, never a name; the customer is the actor of what they sent", () => {
    expect(buildWhatsappMessage({ clientId: "c1", messageId: "m1", direction: "INBOUND", hasMedia: false, origin: "customer", occurredAt: NOW }).actor).toEqual({ type: "customer", id: "c1" });
    expect(buildLeadAssigned({ clientId: "c1", assigneeId: "u2", method: "manual", ref: "r", actorUserId: "u1" })!.actor).toEqual({ type: "user", id: "u1" });
    expect(buildLeadCreated({ clientId: "c1", actorUserId: null }).actor).toEqual({ type: "system", id: null });
  });
});

describe("what is not an event", () => {
  it("KYC 'additional info required' and 'pending' are not decisions", () => {
    expect(buildKycDecision({ clientId: "c1", status: "ADDITIONAL_INFO_REQUIRED", completedAt: NOW, actorUserId: "u" })).toBeNull();
    expect(buildKycDecision({ clientId: "c1", status: "PENDING", completedAt: NOW, actorUserId: "u" })).toBeNull();
  });
  it("only a funded status is an 'account funded' fact", () => {
    expect(buildAccountFunded({ clientId: "c1", status: "PENDING", fundingDate: NOW, actorUserId: "u" })).toBeNull();
    expect(buildAccountFunded({ clientId: "c1", status: "NOT_PROCEEDING", fundingDate: NOW, actorUserId: "u" })).toBeNull();
  });
  it("a lead with no campaign is not a campaign lead", () => {
    expect(buildCampaignLeadAttributed({ clientId: "c1", leadSource: "manual", attribution: null })).toBeNull();
    expect(buildCampaignLeadAttributed({ clientId: "c1", leadSource: "Meta Ads", attribution: { source: "meta_leads" } })).toBeNull();
  });
  it("a campaign id is stored by id, not the campaign's free-text name beyond a short key", () => {
    const e = buildCampaignLeadAttributed({ clientId: "c1", leadSource: "Meta Ads", attribution: { campaign: "x".repeat(300) } });
    expect(JSON.stringify(e!.metadata).length).toBeLessThan(200);
  });
});

describe("Wave 2 integration: memory and decision producers (ids and enums only, never memory content)", () => {
  const base = { occurredAt: NOW, clientId: "c1", itemId: "mem1", class: "PRODUCT_STANCE", actorType: "RM", actorId: "u1", correlationId: null, causationId: null, dataClass: "PERSONAL" } as const;
  it("a memory event stores type, class and the pointer to the item, and never any content", async () => {
    const { row } = await emit(buildMemoryEvent({ type: "customer.memory.confirmed", ...base }));
    expect(row.eventType).toBe("customer.memory.confirmed");
    expect(row.clientId).toBe("c1");
    expect(row.actorType).toBe("user");
    expect(row.actorId).toBe("u1");
    expect(row.metadata).toMatchObject({ ref: { table: "CustomerMemoryItem", id: "mem1" }, memoryClass: "PRODUCT_STANCE" });
    expect(JSON.stringify(row.metadata)).not.toMatch(/evidence|value|text/i);
  });
  it("the same item and transition on the same instant stores once; another instant is another event", async () => {
    const a = buildMemoryEvent({ type: "customer.memory.disputed", ...base })!;
    const b = buildMemoryEvent({ type: "customer.memory.disputed", ...base })!;
    const c = buildMemoryEvent({ type: "customer.memory.disputed", ...base, occurredAt: new Date(NOW.getTime() + 1000) })!;
    expect(a.dedupeKey).toBe(b.dedupeKey);
    expect(a.dedupeKey).not.toBe(c.dedupeKey);
  });
  it("an AI agent is an agent actor, the system is the system", () => {
    expect(buildMemoryEvent({ type: "customer.memory.proposed", ...base, actorType: "AI_AGENT", actorId: "memory_extractor" })!.actor).toEqual({ type: "agent", id: "memory_extractor" });
    expect(buildMemoryEvent({ type: "customer.memory.expired", ...base, actorType: "SYSTEM", actorId: null })!.actor).toEqual({ type: "system", id: null });
  });
  it("a decision event maps the engine's own names onto the registered nba.* types", async () => {
    const created = buildDecisionEvent({ type: "nba.decision.created", clientId: "c1", decisionId: "d1", correlationId: "corr_x", payload: { result: "RECOMMEND", programme: "PMS / AIF opportunity" } })!;
    expect(created.type).toBe("nba.decision.created");
    const { row } = await emit(created);
    expect(row.metadata).toMatchObject({ ref: { table: "DecisionRecord", id: "d1" }, decisionId: "d1", programme: "PMS / AIF opportunity" });
    expect(buildDecisionEvent({ type: "nba.decision.feedback", clientId: "c1", decisionId: "d1", correlationId: "corr_x", payload: { kind: "wrong", reason: "wrong_fact" } })!.type).toBe("nba.decision.rejected_wrong");
    expect(buildDecisionEvent({ type: "nba.decision.feedback", clientId: "c1", decisionId: "d1", correlationId: "corr_x", payload: { kind: "dnr", reason: "customer_asked" } })!.type).toBe("nba.decision.do_not_recommend");
    expect(buildDecisionEvent({ type: "nba.decision.feedback", clientId: "c1", decisionId: "d1", correlationId: "corr_x", payload: { kind: "accept" } })!.type).toBe("nba.decision.accepted");
    expect(buildDecisionEvent({ type: "nba.decision.feedback", clientId: "c1", decisionId: "d1", correlationId: "corr_x", payload: { kind: "done" } })).toBeNull();
    expect(buildDecisionEvent({ type: "nba.decision.outcome", clientId: "c1", decisionId: "d1", correlationId: "corr_x", payload: { kind: "contact" } })!.type).toBe("nba.outcome.linked");
  });
  it("feedback reasons are lists, so the reason code is stored; no free text can reach an event", async () => {
    const { row } = await emit(buildDecisionEvent({ type: "nba.decision.feedback", clientId: "c1", decisionId: "d1", correlationId: "corr_x", payload: { kind: "wrong", reason: "wrong_fact", note: "call 9876543210" } }));
    expect(JSON.stringify(row.metadata)).not.toContain("9876543210");
    expect(row.metadata).toMatchObject({ reasonCode: "wrong_fact" });
  });
});
