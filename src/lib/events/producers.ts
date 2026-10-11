import { dedupeKeyOf, eventIdFor, flowCorrelationId, type EmitInput } from "./envelope";

/**
 * Producers: the one place that knows how a domain fact becomes an event (type, source, actor, dedupe key, correlation and causation). Call sites stay one
 * line (`void emitX(...)`). Pure builders here; the thin emit wrappers are in producers-emit.ts.
 *
 * Rules every builder follows:
 * - The dedupe key is derived from an INTERNAL row id (never a phone, email, name or an external identifier), so a retry stores once and erasure has no
 *   personal value to scrub from a key.
 * - The actor is a user id, the customer (for what they sent), or the system. Never a name.
 * - Metadata carries ids, enums and counts only; the registry strips anything else.
 * - `correlationId` is the customer's flow id, shared by every producer; `lead.assigned` and `lead.contacted` name `lead.created` as their cause.
 */

const WEB = "crm.web";
const user = (id?: string | null): EmitInput["actor"] => (id ? { type: "user", id } : { type: "system", id: null });
const row = (clientId: string, type: string, externalId: string, source = WEB) => ({ source, dedupeKey: dedupeKeyOf(source, externalId, type), correlationId: flowCorrelationId(clientId) });
const ref = (table: string, id: string) => ({ table, id });
const createdEventId = (clientId: string) => eventIdFor(WEB, dedupeKeyOf(WEB, clientId, "lead.created"));

export function buildLeadCreated(p: { clientId: string; leadSource?: string | null; actorUserId?: string | null; occurredAt?: Date }): EmitInput {
  return { type: "lead.created", ...row(p.clientId, "lead.created", p.clientId), actor: user(p.actorUserId), clientId: p.clientId, occurredAt: p.occurredAt, metadata: { ref: ref("Client", p.clientId), leadSource: (p.leadSource ?? "").slice(0, 60) || undefined } };
}

/** `ref` makes the key unique per assignment (the reassign activity id, or the client id for the first assignment). */
export function buildLeadAssigned(p: { clientId: string; assigneeId: string; method: "manual" | "round_robin" | "rule" | "import"; ref: string; actorUserId?: string | null; occurredAt?: Date }): EmitInput | null {
  if (!p.assigneeId) return null;
  return { type: "lead.assigned", ...row(p.clientId, "lead.assigned", `${p.clientId}:${p.ref}`), actor: user(p.actorUserId), clientId: p.clientId, causationId: createdEventId(p.clientId), occurredAt: p.occurredAt, metadata: { ref: ref("Client", p.clientId), assigneeId: p.assigneeId, method: p.method } };
}

export function buildLeadContacted(p: { clientId: string; activityId: string; channel?: "whatsapp" | "sms" | "email" | "call" | "web" | "app" | "other"; actorUserId?: string | null; occurredAt?: Date }): EmitInput {
  return { type: "lead.contacted", ...row(p.clientId, "lead.contacted", p.activityId), actor: user(p.actorUserId), clientId: p.clientId, causationId: createdEventId(p.clientId), occurredAt: p.occurredAt, metadata: { ref: ref("Activity", p.activityId), channel: p.channel } };
}

export function buildLeadLost(p: { clientId: string; ref: string; actorUserId?: string | null; reasonCode?: string }): EmitInput {
  return { type: "lead.lost", ...row(p.clientId, "lead.lost", `${p.clientId}:${p.ref}`), actor: user(p.actorUserId), clientId: p.clientId, metadata: { ref: ref("Client", p.clientId), reasonCode: p.reasonCode } };
}

export function buildStageChanged(p: { clientId: string; historyId: string; fromStageId: string | null; toStageId: string; slaMet: boolean | null; actorUserId?: string | null; occurredAt?: Date }): EmitInput {
  return { type: "customer.stage.changed", ...row(p.clientId, "customer.stage.changed", p.historyId), actor: user(p.actorUserId), clientId: p.clientId, occurredAt: p.occurredAt, metadata: { ref: ref("StageHistory", p.historyId), fromStageId: p.fromStageId, toStageId: p.toStageId, slaMet: p.slaMet } };
}

export function buildKycStarted(p: { clientId: string; submittedAt: Date; method?: string | null; actorUserId?: string | null }): EmitInput {
  return { type: "account.kyc.started", ...row(p.clientId, "account.kyc.started", `${p.clientId}:${p.submittedAt.toISOString()}`), actor: user(p.actorUserId), clientId: p.clientId, occurredAt: p.submittedAt, metadata: { ref: ref("KycRecord", p.clientId), method: (p.method ?? "").slice(0, 60) || undefined } };
}

/** Only APPROVED and REJECTED are decisions; "additional information required" and "pending" are not facts about the outcome. */
export function buildKycDecision(p: { clientId: string; status: string; completedAt: Date; actorUserId?: string | null }): EmitInput | null {
  const type = p.status === "APPROVED" ? "account.kyc.verified" : p.status === "REJECTED" ? "account.kyc.rejected" : null;
  if (!type) return null;
  return { type, ...row(p.clientId, type, `${p.clientId}:${p.completedAt.toISOString()}`), actor: user(p.actorUserId), clientId: p.clientId, occurredAt: p.completedAt, metadata: { ref: ref("KycRecord", p.clientId) } };
}

export function buildAccountFunded(p: { clientId: string; status: string; fundingDate: Date; method?: string | null; actorUserId?: string | null }): EmitInput | null {
  if (p.status !== "FULLY_FUNDED" && p.status !== "PARTIALLY_FUNDED") return null;
  return { type: "account.funded", ...row(p.clientId, "account.funded", `${p.clientId}:${p.status}:${p.fundingDate.toISOString()}`), actor: user(p.actorUserId), clientId: p.clientId, occurredAt: p.fundingDate, metadata: { ref: ref("FundingRecord", p.clientId), method: (p.method ?? "").slice(0, 60) || undefined } };
}

export function buildTransactionRecorded(p: { clientId: string; transactionId: string; type: string; first: boolean; occurredAt: Date }): EmitInput {
  return { type: "transaction.recorded", ...row(p.clientId, "transaction.recorded", p.transactionId, "portfolio.feed"), actor: { type: "integration", id: "portfolio.feed" }, clientId: p.clientId, occurredAt: p.occurredAt, metadata: { ref: ref("Transaction", p.transactionId), transactionType: p.type.slice(0, 60), first: p.first } };
}

export function buildTicketCreated(p: { clientId: string; ticketId: string; provider: string; priority?: string | null; channel?: string | null; occurredAt?: Date }): EmitInput {
  return { type: "ticket.created", ...row(p.clientId, "ticket.created", p.ticketId, p.provider), actor: { type: "integration", id: p.provider }, clientId: p.clientId, occurredAt: p.occurredAt, metadata: { ref: ref("SupportTicket", p.ticketId), provider: p.provider, priority: p.priority ?? null, channel: p.channel ?? null } };
}

export function buildComplaintRaised(p: { clientId: string; insightId: string; severity?: string | null; via: "conversation" | "ticket" | "manual"; occurredAt?: Date }): EmitInput {
  return { type: "complaint.raised", ...row(p.clientId, "complaint.raised", p.insightId), actor: { type: "system", id: null }, clientId: p.clientId, occurredAt: p.occurredAt, metadata: { ref: ref("ConversationInsight", p.insightId), severity: p.severity ?? null, via: p.via } };
}

export function buildWhatsappMessage(p: { clientId: string; messageId: string; direction: "INBOUND" | "OUTBOUND"; hasMedia: boolean; origin?: string | null; occurredAt: Date; templateId?: string | null; senderUserId?: string | null }): EmitInput {
  const inbound = p.direction === "INBOUND";
  const type = inbound ? "whatsapp.message.received" : p.templateId ? "whatsapp.template.sent" : "whatsapp.message.sent";
  const source = "whatsapp.worker";
  return {
    type, ...row(p.clientId, type, p.messageId, source), actor: inbound ? { type: "customer", id: p.clientId } : user(p.senderUserId), clientId: p.clientId, occurredAt: p.occurredAt,
    metadata: { ref: ref("Message", p.messageId), channel: "whatsapp", direction: p.direction, hasMedia: p.hasMedia, origin: p.origin ?? undefined, ...(p.templateId ? { templateId: p.templateId } : {}) },
  };
}

export function buildCallLogged(p: { clientId: string; callId: string; direction: string; durationSeconds: number; startedAt: Date; userId?: string | null }): EmitInput {
  const direction = (["INCOMING", "OUTGOING", "MISSED", "REJECTED"] as const).find((d) => d === p.direction) ?? "OTHER";
  return { type: "call.logged", ...row(p.clientId, "call.logged", p.callId, "crm.device"), actor: user(p.userId), clientId: p.clientId, occurredAt: p.startedAt, metadata: { ref: ref("DeviceCall", p.callId), direction, durationSeconds: Math.max(0, Math.floor(p.durationSeconds)) } };
}

/** A campaign lead is one whose attribution names a campaign. The campaign is stored by its short key only. */
export function buildCampaignLeadAttributed(p: { clientId: string; leadSource?: string | null; attribution: Record<string, unknown> | null }): EmitInput | null {
  const campaign = typeof p.attribution?.campaign === "string" ? p.attribution.campaign.trim() : "";
  if (!campaign) return null;
  const provider = typeof p.attribution?.source === "string" ? p.attribution.source.slice(0, 60) : undefined;
  return { type: "campaign.lead.attributed", ...row(p.clientId, "campaign.lead.attributed", p.clientId), actor: { type: "system", id: null }, clientId: p.clientId, metadata: { ref: ref("Client", p.clientId), provider, campaignId: campaign.slice(0, 80), leadSource: (p.leadSource ?? "").slice(0, 60) || undefined } };
}

export function buildReferralAttributed(p: { clientId: string; referralId: string; referrerId?: string | null; occurredAt?: Date }): EmitInput {
  return { type: "referral.attributed", ...row(p.clientId, "referral.attributed", p.referralId, "app.signup"), actor: { type: "integration", id: "app.signup" }, clientId: p.clientId, occurredAt: p.occurredAt, metadata: { ref: ref("Referral", p.referralId), referralId: p.referralId, referrerId: p.referrerId ?? undefined } };
}

export function buildCustomerMerged(p: { survivorId: string; duplicateId: string; conflicts: number; actorUserId?: string | null }): EmitInput {
  return { type: "customer.merged", ...row(p.survivorId, "customer.merged", p.duplicateId), actor: user(p.actorUserId), clientId: p.survivorId, metadata: { ref: ref("Client", p.duplicateId), survivorId: p.survivorId, duplicateId: p.duplicateId, conflicts: p.conflicts } };
}

export function buildLeadDeduplicated(p: { clientId: string; ledgerId: string; occurredAt?: Date }): EmitInput {
  return { type: "lead.deduplicated", ...row(p.clientId, "lead.deduplicated", p.ledgerId), actor: { type: "system", id: null }, clientId: p.clientId, occurredAt: p.occurredAt, metadata: { ref: ref("LeadIntake", p.ledgerId) } };
}

export function buildReferralQualified(p: { clientId: string; referralId: string; milestone: string; occurredAt?: Date }): EmitInput {
  return { type: "referral.qualified", ...row(p.clientId, "referral.qualified", `${p.referralId}:${p.milestone}`, "app.signup"), actor: { type: "system", id: null }, clientId: p.clientId, occurredAt: p.occurredAt, metadata: { ref: ref("Referral", p.referralId), referralId: p.referralId, milestone: p.milestone.slice(0, 60) } };
}
