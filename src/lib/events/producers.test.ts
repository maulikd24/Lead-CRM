import { describe, expect, it } from "vitest";

import { emitWith, type EventStore, type NewEventRow } from "./emit";
import { eventIdFor, flowCorrelationId } from "./envelope";
import {
  buildAccountFunded, buildCallLogged, buildCampaignConversionFailed, buildCampaignConversionSent, buildCampaignFundedAttributed, buildCampaignLeadAttributed, buildCampaignLeadPushed, buildCampaignLeadSlaBreached,
  buildComplaintRaised, buildCustomerMerged, buildKycDecision, buildKycStarted, buildLeadAssigned, buildLeadContacted, buildLeadCreated, buildLeadLost,
  buildDecisionEvent, buildMemoryEvent, buildReferralAttributed, buildSpeedToContactMeasured, buildStageChanged, buildTicketCreated, buildTransactionRecorded, buildWhatsappMessage,
  buildCreativeDrafted, buildCreativeStep, buildDigestStep, buildReportShareRevoked, buildReportShared, buildCampaignLeadRouted, buildCampaignPlanEvent,
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
    ["campaign.lead.pushed", () => buildCampaignLeadPushed({ clientId: "c1", pushId: "p1", slaMinutes: 15, assigned: true, campaignId: "spring", occurredAt: NOW })],
    ["campaign.lead.sla.breached", () => buildCampaignLeadSlaBreached({ clientId: "c1", pushId: "p1", slaMinutes: 15, minutesPastSla: 7, occurredAt: NOW })],
    ["campaign.funded.attributed", () => buildCampaignFundedAttributed({ clientId: "c1", campaignId: "spring", provider: "meta", confidence: "high", fundedAt: NOW })],
    ["campaign.conversion.sent", () => buildCampaignConversionSent({ clientId: "c1", outboxId: "o1", provider: "meta_capi", eventKind: "KYC_COMPLETE", matched: true, sentAt: NOW })],
    ["campaign.conversion.failed", () => buildCampaignConversionFailed({ clientId: "c1", outboxId: "o1", provider: "meta_capi", eventKind: "FIRST_FUNDING", errorClass: "rejected", occurredAt: NOW })],
    ["lead.speed_to_contact.measured", () => buildSpeedToContactMeasured({ clientId: "c1", pushId: "p1", minutes: 9, contactedAt: NOW })],
    ["campaign.lead.routed", () => buildCampaignLeadRouted({ clientId: "c1", planId: "pl1", via: "rule", occurredAt: NOW })],
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

describe("campaign outcome events thread onto the customer's flow", () => {
  it("share the flow correlation id and name their cause", () => {
    const created = buildLeadCreated({ clientId: "c7", actorUserId: null });
    const pushed = buildCampaignLeadPushed({ clientId: "c7", pushId: "p7", slaMinutes: 15, assigned: false, occurredAt: NOW });
    const breached = buildCampaignLeadSlaBreached({ clientId: "c7", pushId: "p7", slaMinutes: 15, minutesPastSla: 3, occurredAt: NOW });
    const measured = buildSpeedToContactMeasured({ clientId: "c7", pushId: "p7", minutes: 4, contactedAt: NOW });
    const funded = buildCampaignFundedAttributed({ clientId: "c7", campaignId: "x", fundedAt: NOW });
    for (const e of [pushed, breached, measured, funded]) expect(e!.correlationId).toBe(flowCorrelationId("c7"));
    expect(pushed!.causationId).toBe(eventIdFor(created.source, created.dedupeKey));
    expect(breached!.causationId).toBe(eventIdFor(pushed!.source, pushed!.dedupeKey));
    expect(measured!.causationId).toBe(eventIdFor(pushed!.source, pushed!.dedupeKey));
  });
  it("a replay of the same push, breach or funding stores once (the key comes from the row id)", () => {
    expect(buildCampaignLeadPushed({ clientId: "c1", pushId: "p1", slaMinutes: 15, assigned: true, occurredAt: NOW })!.dedupeKey).toBe(buildCampaignLeadPushed({ clientId: "c1", pushId: "p1", slaMinutes: 20, assigned: true, occurredAt: NOW })!.dedupeKey);
    expect(buildCampaignLeadSlaBreached({ clientId: "c1", pushId: "p1", slaMinutes: 15, minutesPastSla: 1, occurredAt: NOW })!.dedupeKey).not.toBe(buildCampaignLeadSlaBreached({ clientId: "c1", pushId: "p2", slaMinutes: 15, minutesPastSla: 1, occurredAt: NOW })!.dedupeKey);
    expect(buildCampaignFundedAttributed({ clientId: "c1", campaignId: "x", fundedAt: NOW })!.dedupeKey).toBe(buildCampaignFundedAttributed({ clientId: "c1", campaignId: "y", fundedAt: new Date(NOW.getTime() + 5) })!.dedupeKey);
  });
  it("carry ids and numbers only: no name, phone, answer text or campaign title", async () => {
    const { row } = await emit(buildCampaignLeadPushed({ clientId: "c1", pushId: "p1", slaMinutes: 15, assigned: true, campaignId: "spring", occurredAt: NOW }));
    expect(JSON.stringify(row.metadata)).not.toMatch(/name|phone|answers|mobile/i);
  });
  it("a campaign funded event is only built when there is a campaign", () => {
    expect(buildCampaignFundedAttributed({ clientId: "c1", campaignId: "", fundedAt: NOW })).toBeNull();
  });
});

describe("conversion send results", () => {
  it("share the customer's flow id, key on the outbox row (a replay stores once) and carry no identifier, hash or value", async () => {
    const sent = buildCampaignConversionSent({ clientId: "c7", outboxId: "o7", provider: "meta_capi", eventKind: "FIRST_FUNDING", matched: false, sentAt: NOW });
    const failed = buildCampaignConversionFailed({ clientId: "c7", outboxId: "o7", provider: "google_ads", eventKind: "KYC_COMPLETE", errorClass: "rejected", occurredAt: NOW });
    expect(sent.correlationId).toBe(flowCorrelationId("c7"));
    expect(failed.correlationId).toBe(flowCorrelationId("c7"));
    expect(buildCampaignConversionSent({ clientId: "c7", outboxId: "o7", provider: "meta_capi", eventKind: "FIRST_FUNDING", matched: true, sentAt: new Date(NOW.getTime() + 5000) }).dedupeKey).toBe(sent.dedupeKey);
    expect(sent.dedupeKey).not.toBe(failed.dedupeKey);
    const { row } = await emit(sent);
    expect(JSON.stringify(row.metadata)).not.toMatch(/hash|email|phone|value|fbc|gclid|[0-9a-f]{32}/i);
    expect(row.consentContext).toMatchObject({ purpose: "ADS_MEASUREMENT", status: "GRANTED" });
  });
});
describe("creative and report events (internal facts about staff work, never about a customer)", () => {
  const all = () => [
    buildCreativeDrafted({ briefId: "b1", variants: 3, source: "AI", actorUserId: "u1", occurredAt: NOW }),
    buildCreativeStep({ kind: "submitted", briefId: "b1", variantId: "v1", stepId: "e1", actorUserId: "u1", occurredAt: NOW }),
    buildCreativeStep({ kind: "approved", briefId: "b1", variantId: "v1", stepId: "e2", actorUserId: "u2", occurredAt: NOW }),
    buildCreativeStep({ kind: "returned", briefId: "b1", variantId: "v1", stepId: "e3", actorUserId: "u2", occurredAt: NOW }),
    buildReportShared({ shareId: "s1", expiresInDays: 7, actorUserId: "u1", occurredAt: NOW }),
    buildReportShareRevoked({ shareId: "s1", actorUserId: "u1", occurredAt: NOW }),
    buildDigestStep({ kind: "prepared", digestId: "d1", hasData: true, occurredAt: NOW }),
    buildDigestStep({ kind: "approved", digestId: "d1", actorUserId: "u1", occurredAt: NOW }),
    buildDigestStep({ kind: "discarded", digestId: "d1", actorUserId: "u1", occurredAt: NOW }),
  ];
  const types = ["campaign.creative.drafted", "campaign.creative.submitted", "campaign.creative.approved", "campaign.creative.returned", "campaign.report.shared", "campaign.report.share.revoked", "campaign.report.digest.prepared", "campaign.report.digest.approved", "campaign.report.digest.discarded"];
  it("are all stored, not rejected, with no customer", async () => {
    for (const [i, input] of all().entries()) {
      const { out, row } = await emit(input);
      expect(out.status, types[i]).toBe("stored");
      expect(row.eventType).toBe(types[i]);
      expect(row.clientId).toBeNull();
    }
  });
  it("the actor is the person (or the system for the weekly job), never a name", () => {
    expect(all()[1].actor).toEqual({ type: "user", id: "u1" });
    expect(all()[6].actor).toEqual({ type: "system", id: null });
  });
  it("one flow per brief: its variants' steps share the brief's correlation id and name the drafting as their cause", () => {
    const [drafted, submitted, approved, changes] = all();
    for (const e of [drafted, submitted, approved, changes]) expect(e.correlationId).toBe(flowCorrelationId("creative:b1"));
    for (const e of [submitted, approved, changes]) expect(e.causationId).toBe(eventIdFor(drafted.source, drafted.dedupeKey));
    expect(drafted.causationId).toBeUndefined();
  });
  it("one flow per report: revoking names the sharing as its cause; approving or discarding a digest names its preparation", () => {
    const e = all();
    expect(e[5].correlationId).toBe(e[4].correlationId);
    expect(e[5].causationId).toBe(eventIdFor(e[4].source, e[4].dedupeKey));
    expect(e[7].causationId).toBe(eventIdFor(e[6].source, e[6].dedupeKey));
    expect(e[8].causationId).toBe(eventIdFor(e[6].source, e[6].dedupeKey));
  });
  it("a replay stores once (the key comes from the row id), and two steps of one variant are two facts", () => {
    expect(buildCreativeDrafted({ briefId: "b1", variants: 3, source: "AI", actorUserId: "u1" }).dedupeKey).toBe(buildCreativeDrafted({ briefId: "b1", variants: 9, source: "STAFF", actorUserId: "u2" }).dedupeKey);
    expect(all()[1].dedupeKey).not.toBe(all()[2].dedupeKey);
    expect(buildCreativeStep({ kind: "approved", briefId: "b1", variantId: "v1", stepId: "e2", actorUserId: "u2" }).dedupeKey).toBe(all()[2].dedupeKey);
  });
  it("carry ids, enums and numbers only: no copy, no title, no topic, no link", async () => {
    for (const input of all()) {
      const { row } = await emit(input);
      expect(JSON.stringify(row.metadata)).not.toMatch(/copy|headline|title|topic|https?:|token/i);
    }
  });
});
describe("campaign plan events (the planner's side of the one event path)", () => {
  const plan = { planId: "pl1", code: "CP-ABC234", channel: "search_ad", eventId: "ev1", actorUserId: "u1", occurredAt: NOW };
  it.each(["submitted", "approved", "sent_back", "scheduled"] as const)("campaign.plan.%s is stored with no customer, on the plan's own correlation id", async (kind) => {
    const { out, row } = await emit(buildCampaignPlanEvent(kind, plan));
    expect(out.status).toBe("stored");
    expect(row.eventType).toBe(`campaign.plan.${kind}`);
    expect(row.clientId).toBeNull();
    expect(row.correlationId).toBe(flowCorrelationId("plan:pl1"));
  });
  it("is idempotent per planner audit row: the same row stores once, a new row stores again", () => {
    const a = buildCampaignPlanEvent("approved", plan)!;
    expect(buildCampaignPlanEvent("approved", plan)!.dedupeKey).toBe(a.dedupeKey);
    expect(buildCampaignPlanEvent("approved", { ...plan, eventId: "ev2" })!.dedupeKey).not.toBe(a.dedupeKey);
  });
  it("carries ids and enums only: no title, note or person's name", () => {
    const e = buildCampaignPlanEvent("submitted", plan)!;
    expect(Object.keys(e.metadata ?? {}).sort()).toEqual(["channel", "code", "planId", "ref"]);
  });
  it("a routed lead names the plan and how it was routed, and is caused by lead.created", () => {
    const e = buildCampaignLeadRouted({ clientId: "c1", planId: "pl1", via: "fallback", occurredAt: NOW });
    expect(e.causationId).toBe(eventIdFor("crm.web", "crm.web:c1:lead.created"));
    expect(e.metadata).toMatchObject({ planId: "pl1", via: "fallback" });
    expect(e.correlationId).toBe(flowCorrelationId("c1"));
  });
});
