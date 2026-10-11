// Policy and consent gate: given a candidate that survived suppression, which channel may it use right now?
// Pure. Uses the ledger's own decision function (lib/consent/decision.ts) and its policy table, so there is ONE consent rulebook.
import { consentDecision } from "@/lib/consent/decision";
import { CONSENT_POLICY, type ConsentChannel, type ConsentPurpose } from "@/lib/consent/policy";
import { checkCopy } from "@/lib/agents/guardrails";
import { ENGINE_CONFIG } from "./constants";
import type { GateContext } from "./gate-context";
import type { Candidate, DecisionAction, DecisionChannel, PolicyResult, Suppression } from "./types";

export type ChannelResolution = {
  /** null means no allowed channel: the candidate cannot be recommended as it stands. */
  channel: DecisionChannel | null;
  action: DecisionAction;
  policy: PolicyResult;
  blocks: Suppression[];
};

const CHAIN: Record<DecisionChannel, DecisionChannel[]> = {
  whatsapp: ["whatsapp", "call", "email"],
  email: ["email", "call"],
  call: ["call"],
  in_person: ["in_person"],
  none: ["none"],
};

const ACTION_FOR: Partial<Record<DecisionChannel, DecisionAction>> = { call: "Call", whatsapp: "WhatsApp", email: "Email" };
const CONSENT_CHANNEL: Record<string, ConsentChannel> = { call: "call", whatsapp: "whatsapp", email: "email", in_person: "call" };

export const purposeFor = (c: Pick<Candidate, "sales">): ConsentPurpose => (c.sales ? "MARKETING_COMMS" : "SERVICE_COMMS");

function windowOpen(g: GateContext): boolean {
  return !!g.lastInboundWhatsAppAt && g.now.getTime() - g.lastInboundWhatsAppAt.getTime() <= ENGINE_CONFIG.whatsappWindowHours * 3600 * 1000;
}

export function resolveChannel(c: Candidate, g: GateContext): ChannelResolution {
  const aiOwned = c.owner === "AI Bot";
  const guard = checkCopy(c.reason, 1000).ok ? "ok" : "flagged";
  const base = { guardrails: guard as PolicyResult["guardrails"], approvalNeeded: aiOwned, approver: aiOwned ? "RM" : null };
  const blocks: Suppression[] = [];
  const block = (rule: Suppression["rule"], because: string) => blocks.push({ rule, effect: "block", until: null, because, candidateId: c.id });

  if (c.channel === "none") {
    return { channel: "none", action: c.action, policy: { consent: "ok", consentPurpose: null, consentReason: null, window: "not_applicable", ...base }, blocks };
  }

  const purpose = purposeFor(c);
  const policy = g.consent.policy ?? CONSENT_POLICY;
  let lastReason: string | null = null;
  for (const ch of CHAIN[c.channel]) {
    const decision = consentDecision(g.consent.rows, purpose, CONSENT_CHANNEL[ch] ?? null, g.now, { legacyMarketingConsentAt: g.consent.legacyMarketingConsentAt, policy });
    if (!decision.allowed) {
      lastReason = decision.reason;
      block("consent_dnd", `${ch}: ${decision.reason === "DO_NOT_CONTACT" ? "do not contact is on" : decision.reason === "WITHDRAWN" ? "consent withdrawn" : decision.reason === "EXPIRED" ? "consent expired" : "no consent on record"} for ${purpose.toLowerCase().replace(/_/g, " ")}`);
      continue;
    }
    let window: PolicyResult["window"] = "not_applicable";
    if (ch === "whatsapp") {
      window = windowOpen(g) ? "ok" : "closed";
      if (window === "closed" && !g.approvedTemplateExists) {
        block("whatsapp_window", "Outside the 24 hour WhatsApp window and no approved template: free text is not allowed, so a call or a template is needed");
        lastReason = "WINDOW_CLOSED";
        continue;
      }
    }
    return { channel: ch, action: ACTION_FOR[ch] ?? c.action, policy: { consent: "ok", consentPurpose: purpose, consentReason: decision.reason, window, ...base }, blocks };
  }
  return { channel: null, action: c.action, policy: { consent: lastReason === "WINDOW_CLOSED" ? "ok" : "blocked", consentPurpose: purpose, consentReason: lastReason, window: "closed", ...base }, blocks };
}
