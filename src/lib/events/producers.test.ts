import { describe, expect, it } from "vitest";

import { emitWith, type EventStore, type NewEventRow } from "./emit";
import { eventIdFor, flowCorrelationId } from "./envelope";
import {
  buildAccountFunded, buildCallLogged, buildCampaignConversionFailed, buildCampaignConversionSent, buildCampaignFundedAttributed, buildCampaignLeadAttributed, buildCampaignLeadPushed, buildCampaignLeadSlaBreached, buildComplaintRaised, buildCustomerMerged, buildKycDecision, buildKycStarted, buildLeadAssigned, buildLeadContacted, buildLeadCreated, buildLeadLost,
  buildReferralAttributed, buildSpeedToContactMeasured, buildStageChanged, buildTicketCreated, buildTransactionRecorded, buildWhatsappMessage,
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
