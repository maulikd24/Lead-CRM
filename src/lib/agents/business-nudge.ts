import { prisma } from "@/lib/db/prisma";
import { checkConsent, defaultEnforceDeps } from "@/lib/consent/enforce";
import { sendMessage } from "@/lib/messaging/send";
import { NUDGER_PROGRAMMES, safeFirstName, type NudgerDeps } from "./nudger";
import { reasonCategoryFor, type ReasonCategory } from "./reason-category";

/**
 * Proactive nudges from the official business number (WhatsApp Cloud API), approved templates only.
 * The owner's decision: a nudge never leaves from an RM's personal number and never carries free text. An approved draft is
 * mapped to the approved template for its intent; with no approved template the nudge is not sent and the draft stays with the RM.
 * The RM's approval (AgentProposal APPROVED, see decide.ts) is still required before anything is sent.
 */

/**
 * Template per nudge intent (the reasonCategory, which the nudger derives from the programme and the customer's situation).
 * The names are placeholders the owner must register in Meta (and mark approved in the Message Templates table).
 * A null entry means no template exists for that intent, so the nudge is not sent. The only variable is {{1}} = first name.
 */
export const NUDGE_TEMPLATE_REGISTRY: Record<ReasonCategory, string | null> = {
  kyc_pending: "allvest_nudge_kyc_pending",
  kyc_stuck_in_documents: "allvest_nudge_kyc_documents",
  signed_up_not_funded: "allvest_nudge_fund_account",
  funded_no_first_transaction: "allvest_nudge_first_transaction",
  other_onboarding: null,
};

/** Refusal that leaves the draft as a DRAFT. decide.ts releases the claim and shows this message to the RM. */
export class NudgeNotSentError extends Error {
  readonly code = "NUDGE_NOT_SENT";
}

export type BusinessNudgeDeps = {
  enabled: () => boolean;
  briefing: NudgerDeps["briefing"];
  consent: (clientId: string) => Promise<{ allowed: boolean; reason: string }>;
  /** The approved, Meta-registered template with this external name, or null. */
  findApprovedTemplate: (externalId: string) => Promise<{ id: string } | null>;
  /** The existing template send (src/lib/messaging/send.ts), which calls the Cloud API adapter. */
  sendTemplate: (input: { clientId: string; templateId: string; variables: Record<string, string>; senderUserId: string }) => Promise<{ id: string }>;
};

/** Off unless the value is exactly "1". Read here, not through a helper, so the flag scan sees the name. */
export function businessNudgeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.WA_BUSINESS_NUDGE_ENABLED === "1";
}

/** Production deps. Consent is always checked here, even while CONSENT_ENFORCEMENT is off, so do-not-contact and withdrawn are refused. */
export function businessNudgeDeps(briefing: NudgerDeps["briefing"]): BusinessNudgeDeps {
  return {
    enabled: () => businessNudgeEnabled(),
    briefing,
    consent: async (clientId) => {
      const d = await checkConsent(clientId, "MARKETING_COMMS", "whatsapp", { ...defaultEnforceDeps(), enforced: () => true });
      return { allowed: d.allowed, reason: d.reason };
    },
    findApprovedTemplate: (externalId) =>
      prisma.messageTemplate.findFirst({ where: { channel: "whatsapp", externalId, approved: true }, select: { id: true } }),
    sendTemplate: async ({ clientId, templateId, variables, senderUserId }) => {
      const message = await sendMessage({ clientId, channel: "whatsapp", templateId, variables, senderUserId });
      return { id: message.id };
    },
  };
}

/**
 * Sends one approved nudge as its intent's approved template. The draft text is never sent: the template body and the
 * first name are the only content that reaches the Cloud API. Throws NudgeNotSentError in every refusal case, before any send.
 */
export async function sendApprovedNudge(
  input: { clientId: string; programme: string | null; senderUserId: string },
  deps: BusinessNudgeDeps,
): Promise<{ messageId: string; templateName: string }> {
  if (!deps.enabled()) throw new NudgeNotSentError("Not sent: business WhatsApp nudges are switched off (WA_BUSINESS_NUDGE_ENABLED).");

  const consent = await deps.consent(input.clientId);
  if (!consent.allowed) throw new NudgeNotSentError(`Not sent: the customer's consent does not allow it (${consent.reason}).`);

  const b = await deps.briefing(input.clientId);
  if (!b) throw new NudgeNotSentError("Not sent: customer not found.");
  const programme = b.whyContactingNow.programme;
  if (!input.programme || programme !== input.programme || !(NUDGER_PROGRAMMES as readonly string[]).includes(programme)) {
    throw new NudgeNotSentError("Not sent: the nudge's programme has changed since the draft. The draft stays with the RM.");
  }

  // The intent is recomputed from the same inputs the draft used (no intent column on AgentProposal).
  const category = reasonCategoryFor(b);
  const templateName = NUDGE_TEMPLATE_REGISTRY[category];
  const template = templateName ? await deps.findApprovedTemplate(templateName) : null;
  if (!templateName || !template) {
    throw new NudgeNotSentError(`Not sent: no approved WhatsApp template for this nudge (${category}). The draft stays with the RM.`);
  }

  const message = await deps.sendTemplate({
    clientId: input.clientId,
    templateId: template.id,
    variables: { firstName: safeFirstName(b.customer.name) },
    senderUserId: input.senderUserId,
  });
  return { messageId: message.id, templateName };
}
