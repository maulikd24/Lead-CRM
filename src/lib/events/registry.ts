import { z } from "zod";

import { RefSchema, isValidEventTypeName, type EventDataClass } from "./envelope";

/**
 * THE event registry (the event taxonomy): every event type, its current schema version, the zod schema of its
 * metadata per version, its data classification and whether it needs a customer or a consent snapshot. `registry.test.ts`
 * fails when the v1 taxonomy and this file disagree, and `emit()` refuses a type that is not listed here.
 *
 * Rules for metadata (kept short on purpose):
 * - Ids, enums, numbers and booleans. Never free text, never a name, phone, email or PAN: where an id will do, the id is stored and the
 *   domain row stays the place that holds the detail. zod strips any key the schema does not name, so an extra field cannot be stored by accident.
 * - Every payload may carry `ref`, the pointer back to the authoritative domain row (used by the timeline for its "open the record" link).
 * - Versioning: an additive change keeps the version; a breaking change adds version N+1 next to N (readers handle N and N-1) or a new type.
 */

const id = z.string().min(1).max(120);
const short = z.string().min(1).max(60);
const ref = RefSchema.optional();
const base = { ref };
/** Builds a metadata object schema that always allows the shared `ref`. Unknown keys are stripped (zod default). */
const meta = <T extends z.ZodRawShape>(shape: T) => z.object({ ...base, ...shape });

export type EventDef = {
  type: string;
  description: string;
  currentVersion: number;
  schemas: Record<number, z.ZodType<Record<string, unknown>>>;
  /** Upgrades the metadata of an older version to the shape of the next one, so readers can handle N and N-1. */
  upcast?: Record<number, (metadata: Record<string, unknown>) => Record<string, unknown>>;
  dataClass: EventDataClass;
  /** An event about a person must carry customer_id; only system, intake and campaign-level facts may not. */
  customerRequired: boolean;
  /** Processes personal data on a channel that needs consent: a missing consent_context is counted (never dropped). */
  consentRequired: boolean;
  /** The domain table this fact mirrors; the table stays authoritative. */
  mirrors: string | null;
};

type Opts = { customer?: boolean; consent?: boolean; mirrors?: string | null };
const REGISTRY: Record<string, EventDef> = {};
function def(type: string, dataClass: EventDataClass, description: string, shape: z.ZodRawShape = {}, opts: Opts = {}) {
  if (!isValidEventTypeName(type)) throw new Error(`Invalid event type name: ${type}`);
  REGISTRY[type] = {
    type,
    description,
    currentVersion: 1,
    schemas: { 1: meta(shape) as unknown as z.ZodType<Record<string, unknown>> },
    dataClass,
    customerRequired: opts.customer ?? true,
    consentRequired: opts.consent ?? false,
    mirrors: opts.mirrors ?? null,
  };
}

const channel = z.enum(["whatsapp", "sms", "email", "call", "web", "app", "other"]).optional();
const money = z.number().finite().optional();

// ---- lead -----------------------------------------------------------------------------------------------------------------------
def("lead.intake.received", "INTERNAL", "A raw inbound submission reached the intake (before identity resolution).", { intakeSource: short.optional(), status: short.optional() }, { customer: false, mirrors: "LeadIntake" });
def("lead.intake.failed", "INTERNAL", "An intake submission could not be turned into a customer.", { intakeSource: short.optional(), errorClass: short.optional() }, { customer: false, mirrors: "LeadIntake" });
def("lead.created", "PERSONAL", "A new customer record was created as a lead.", { leadSource: short.optional(), channel }, { mirrors: "Client" });
def("lead.deduplicated", "PERSONAL", "An inbound lead matched an existing customer instead of creating one.", { matchedOn: z.enum(["mobile", "email", "pan", "app_user_id"]).optional() }, { mirrors: "Client" });
def("lead.assigned", "PERSONAL", "A lead was assigned to a relationship manager.", { assigneeId: id.optional(), method: z.enum(["manual", "round_robin", "rule", "import"]).optional() }, { mirrors: "Client" });
def("lead.contacted", "PERSONAL", "The first or a follow-up contact with a lead was logged.", { channel, activityType: short.optional(), first: z.boolean().optional() }, { mirrors: "Activity" });
def("lead.qualified", "PERSONAL", "A lead was qualified.", { stage: short.optional() }, { mirrors: "Client" });
def("lead.lost", "PERSONAL", "A lead was marked lost or not proceeding.", { reasonCode: short.optional() }, { mirrors: "Client" });
def("lead.speed_to_contact.measured", "INTERNAL", "Minutes from lead creation to first contact.", { minutes: z.number().nonnegative().optional() }, { mirrors: "Activity" });

// ---- customer ---------------------------------------------------------------------------------------------------------------------
def("customer.created", "PERSONAL", "A customer record exists.", { leadSource: short.optional() }, { mirrors: "Client" });
def("customer.merged", "PERSONAL", "A duplicate customer was merged into a survivor.", { survivorId: id, duplicateId: id, conflicts: z.number().int().nonnegative().optional() }, { mirrors: "Client" });
def("customer.updated", "PERSONAL", "Fields of the customer record changed (field names only).", { fields: z.array(short).max(40).optional() }, { mirrors: "Client" });
def("customer.stage.changed", "INTERNAL", "The onboarding stage changed.", { fromStageId: id.nullable().optional(), toStageId: id.optional(), slaMet: z.boolean().nullable().optional() }, { mirrors: "StageHistory" });
def("customer.consent.granted", "PERSONAL", "Consent was granted for a purpose.", { purpose: short.optional(), channel: short.nullable().optional(), noticeVersion: short.nullable().optional() }, { mirrors: "ConsentRecord" });
def("customer.consent.withdrawn", "PERSONAL", "Consent was withdrawn for a purpose.", { purpose: short.optional(), channel: short.nullable().optional() }, { mirrors: "ConsentRecord" });
def("customer.goal.created", "SENSITIVE_PERSONAL", "A customer goal was recorded.", { goalType: short.optional() }, { mirrors: "CustomerGoal" });
def("customer.goal.updated", "SENSITIVE_PERSONAL", "A customer goal changed.", { goalType: short.optional() }, { mirrors: "CustomerGoal" });
def("customer.review.completed", "SENSITIVE_PERSONAL", "A customer review was completed.", {}, { mirrors: "CustomerReview" });
def("customer.erased", "INTERNAL", "The customer was permanently erased; earlier events keep only id, type and times.", { mergedDuplicates: z.number().int().nonnegative().optional() }, { mirrors: "ErasureRequest" });

// ---- account ----------------------------------------------------------------------------------------------------------------------
def("account.kyc.started", "SENSITIVE_PERSONAL", "KYC was started.", { method: short.optional() }, { mirrors: "KycRecord" });
def("account.kyc.step.completed", "SENSITIVE_PERSONAL", "A KYC step was completed.", { step: short.optional(), status: short.optional() }, { mirrors: "KycStep" });
def("account.kyc.verified", "SENSITIVE_PERSONAL", "KYC was completed and verified.", {}, { mirrors: "KycRecord" });
def("account.kyc.rejected", "SENSITIVE_PERSONAL", "KYC was rejected.", { reasonCode: short.optional() }, { mirrors: "KycRecord" });
def("account.opened", "SENSITIVE_PERSONAL", "A trading account was opened.", { accountType: short.optional() }, { mirrors: "TradingAccount" });
def("account.funded", "SENSITIVE_PERSONAL", "The account was funded.", { amountBand: short.optional(), method: short.optional() }, { mirrors: "FundingRecord" });
def("account.closed", "SENSITIVE_PERSONAL", "An account was closed.", {}, { mirrors: "TradingAccount" });

// ---- transaction and portfolio ------------------------------------------------------------------------------------------------------
def("transaction.recorded", "SENSITIVE_PERSONAL", "A transaction arrived from the feed (the CRM never moves money).", { transactionType: short.optional(), first: z.boolean().optional(), amount: money }, { mirrors: "Transaction" });
def("transaction.sip.started", "SENSITIVE_PERSONAL", "A SIP was started.", { amount: money }, { mirrors: "Transaction" });
def("transaction.sip.missed", "SENSITIVE_PERSONAL", "A SIP instalment was missed (derived).", { dueDate: z.string().max(10).optional() }, { mirrors: "Transaction" });
def("portfolio.snapshot.updated", "SENSITIVE_PERSONAL", "Positions were refreshed from the feed.", { asOfDate: z.string().max(10).optional(), positions: z.number().int().nonnegative().optional() }, { mirrors: "Position" });
def("portfolio.holding.changed", "SENSITIVE_PERSONAL", "A holding changed.", { productId: id.optional() }, { mirrors: "Position" });
def("portfolio.external_holding.declared", "SENSITIVE_PERSONAL", "The customer declared a holding held elsewhere.", { assetClass: short.optional() }, { mirrors: "ConversationInsight" });

// ---- whatsapp and calls -------------------------------------------------------------------------------------------------------------
const wa = { channel: short.optional(), direction: z.enum(["INBOUND", "OUTBOUND"]).optional(), hasMedia: z.boolean().optional(), origin: short.optional() };
def("whatsapp.message.received", "PERSONAL", "A WhatsApp message arrived from the customer.", wa, { consent: true, mirrors: "Message" });
def("whatsapp.message.sent", "PERSONAL", "A WhatsApp message was sent to the customer.", { ...wa, templateId: id.optional() }, { consent: true, mirrors: "Message" });
def("whatsapp.message.delivered", "INTERNAL", "A sent WhatsApp message was delivered.", wa, { mirrors: "Message" });
def("whatsapp.message.read", "INTERNAL", "A sent WhatsApp message was read.", wa, { mirrors: "Message" });
def("whatsapp.window.expired", "INTERNAL", "The 24 hour customer-service window closed.", {}, { mirrors: "Message" });
def("whatsapp.handover.detected", "PERSONAL", "The reply assistant detected a handover to a human.", { reasonCode: short.optional() }, { mirrors: "AgentProposal" });
def("whatsapp.template.sent", "PERSONAL", "A template message was sent.", { templateId: id.optional() }, { consent: true, mirrors: "Message" });
def("call.logged", "PERSONAL", "A call was logged.", { direction: z.enum(["INCOMING", "OUTGOING", "MISSED", "REJECTED", "OTHER"]).optional(), durationSeconds: z.number().int().nonnegative().optional() }, { mirrors: "DeviceCall" });
def("call.recording.available", "SENSITIVE_PERSONAL", "A call recording became available.", {}, { mirrors: "ConversationReview" });
def("call.review.completed", "SENSITIVE_PERSONAL", "A call review was completed.", {}, { mirrors: "ConversationReview" });

// ---- ticket and complaint --------------------------------------------------------------------------------------------------------------
def("ticket.created", "PERSONAL", "A support ticket was created.", { provider: short.optional(), priority: short.nullable().optional(), channel: short.nullable().optional() }, { mirrors: "SupportTicket" });
def("ticket.status.changed", "PERSONAL", "A support ticket changed status.", { status: short.nullable().optional() }, { mirrors: "SupportTicket" });
def("ticket.resolved", "PERSONAL", "A support ticket was resolved.", {}, { mirrors: "SupportTicket" });
def("ticket.sla.breached", "INTERNAL", "A support deadline was missed.", { ticketId: id.optional() }, { mirrors: "SupportTicket" });
def("complaint.raised", "PERSONAL", "A complaint was raised or detected.", { severity: short.nullable().optional(), via: z.enum(["conversation", "ticket", "manual"]).optional() }, { mirrors: "ConversationInsight" });
def("complaint.acknowledged", "PERSONAL", "A complaint was acknowledged.", {}, { mirrors: "ConversationInsight" });
def("complaint.resolved", "PERSONAL", "A complaint was resolved.", {}, { mirrors: "ConversationInsight" });

// ---- campaign ---------------------------------------------------------------------------------------------------------------------------
def("campaign.spend.synced", "PUBLIC_AGGREGATE", "Ad spend facts were synced for a campaign and day.", { provider: short.optional(), campaignId: id.optional(), day: z.string().max(10).optional() }, { customer: false, mirrors: "ad spend facts" });
def("campaign.lead.attributed", "PERSONAL", "A lead was attributed to a campaign.", { provider: short.optional(), campaignId: id.optional(), leadSource: short.optional() }, { mirrors: "Client" });
def("campaign.conversion.sent", "PERSONAL", "A conversion was sent back to the ad platform.", { provider: short.optional() }, { consent: true });
def("campaign.conversion.failed", "INTERNAL", "A conversion send failed.", { provider: short.optional(), errorClass: short.optional() });
def("campaign.autopilot.recommended", "INTERNAL", "The ad autopilot recommended an action.", { recommendationId: id.optional() }, { customer: false });
def("campaign.autopilot.approved", "INTERNAL", "A human approved an autopilot recommendation.", { recommendationId: id.optional() }, { customer: false });
def("campaign.autopilot.applied", "INTERNAL", "An approved autopilot action was applied.", { recommendationId: id.optional() }, { customer: false });

// ---- referral ---------------------------------------------------------------------------------------------------------------------------
def("referral.code.issued", "PERSONAL", "A referral code was issued to a referrer.", { referrerId: id.optional() }, { mirrors: "ReferralCode" });
def("referral.attributed", "PERSONAL", "A referred customer was attributed to a referrer.", { referralId: id.optional(), referrerId: id.optional() }, { mirrors: "Referral" });
def("referral.flagged", "PERSONAL", "A referral was flagged for review.", { referralId: id.optional(), reasonCode: short.optional() }, { mirrors: "Referral" });
def("referral.qualified", "PERSONAL", "A referral qualified (KYC or funding reached).", { referralId: id.optional(), milestone: short.optional() }, { mirrors: "Referral" });
def("referral.reward.accrued", "PERSONAL", "A reward was accrued in the ledger.", { referralId: id.optional(), amount: money }, { mirrors: "RewardLedgerEntry" });
def("referral.reward.clawed_back", "PERSONAL", "A reward was clawed back.", { referralId: id.optional(), amount: money }, { mirrors: "RewardLedgerEntry" });

// ---- nba and agent ------------------------------------------------------------------------------------------------------------------------
for (const [t, d] of [
  ["created", "A next best action decision was created."], ["suppressed", "A candidate was suppressed."], ["accepted", "The decision was accepted."], ["snoozed", "The decision was snoozed."],
  ["rejected_wrong", "The decision was rejected as wrong."], ["not_now", "The decision was marked not now."], ["do_not_recommend", "The customer was marked do-not-recommend for this action."], ["expired", "The decision expired."],
] as const) def(`nba.decision.${t}`, "INTERNAL", d, { decisionId: id.optional(), programme: short.optional(), reasonCode: short.optional() });
def("nba.outcome.linked", "INTERNAL", "An outcome was linked to a decision.", { decisionId: id.optional(), outcome: short.optional() });
def("agent.run.started", "INTERNAL", "An agent run started.", { agentKey: short, runId: id.optional() }, { customer: false });
def("agent.run.completed", "INTERNAL", "An agent run completed.", { agentKey: short, runId: id.optional(), outcome: short.optional() }, { customer: false });
def("agent.run.blocked", "INTERNAL", "An agent run was blocked by a guard.", { agentKey: short, runId: id.optional(), reasonCode: short.optional() }, { customer: false });
def("agent.run.failed", "INTERNAL", "An agent run failed.", { agentKey: short, runId: id.optional(), errorClass: short.optional() }, { customer: false });
def("agent.proposal.drafted", "PERSONAL", "An agent drafted a proposal (a draft, never a send).", { agentKey: short.optional(), proposalId: id.optional() }, { mirrors: "AgentProposal" });
def("agent.proposal.approved", "PERSONAL", "A human approved an agent proposal.", { proposalId: id.optional() }, { mirrors: "AgentProposal" });
def("agent.proposal.rejected", "PERSONAL", "A human rejected an agent proposal.", { proposalId: id.optional(), reasonCategory: short.optional() }, { mirrors: "AgentProposal" });
def("agent.proposal.sent", "PERSONAL", "An approved agent proposal was sent.", { proposalId: id.optional() }, { consent: true, mirrors: "AgentProposal" });
def("agent.killswitch.toggled", "INTERNAL", "An agent kill switch changed.", { agentKey: short, enabled: z.boolean().optional() }, { customer: false });

export const EVENT_REGISTRY: Readonly<Record<string, EventDef>> = REGISTRY;
export const registeredTypes = (): string[] => Object.keys(REGISTRY);
export const eventDef = (type: string): EventDef | undefined => REGISTRY[type];
