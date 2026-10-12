import { consentDecision, currentStates, type ConsentRow } from "@/lib/consent/decision";
import { CONSENT_POLICY } from "@/lib/consent/policy";
import { sourceLabel } from "@/lib/consent/view";

export type MarketingConsent = "given" | "withdrawn" | "expired" | "do_not_contact" | "not_recorded";

export type ConsentStatus = {
  marketing: MarketingConsent;
  /** When the entry that decides the state was recorded (a ledger entry, or the lead-form timestamp). */
  consentAtIso: string | null;
  /** Where that entry came from, in words ("App", "Lead form"); null when nothing is recorded. */
  sourceLabel: string | null;
  channelLabel: string | null;
  consentText: string | null;
  salesPaused: boolean;
  doNotPitch: boolean;
};

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", sms: "SMS", email: "Email", call: "Call", push: "Push" };

type Input = {
  marketingConsentAt: Date | null;
  marketingConsentText: string | null;
  openIssueCount: number;
  nbaProgramme: string | null;
  /** The customer's consent ledger rows. The ledger is the record; the lead-form timestamp is only the fallback. */
  records: readonly ConsentRow[];
  now: Date;
};

/**
 * Consent and contact-restriction state. Marketing consent is judged the same way the inbox warning is (as if an opt-in
 * were required), from the consent ledger first and the lead-form timestamp as the fallback, so this card can never
 * say "Not recorded" while the ledger says Granted. No invented opt-out flag.
 */
export function buildConsentStatus(input: Input): ConsentStatus {
  const required = { ...CONSENT_POLICY, MARKETING_COMMS: { ...CONSENT_POLICY.MARKETING_COMMS, mode: "required" as const } };
  const decision = consentDecision(input.records, "MARKETING_COMMS", null, input.now, { legacyMarketingConsentAt: input.marketingConsentAt, policy: required });

  const marketing: MarketingConsent =
    decision.reason === "DO_NOT_CONTACT" ? "do_not_contact" : decision.state === "GRANTED" ? "given" : decision.state === "WITHDRAWN" ? "withdrawn" : decision.state === "EXPIRED" ? "expired" : "not_recorded";

  // The entry the state was read from: the newest in-effect ledger row for the purpose (or the do-not-contact flag), else the lead form.
  const inEffect = input.records.filter((r) => r.capturedAt.getTime() <= input.now.getTime());
  const purposeFor = marketing === "do_not_contact" ? "DO_NOT_CONTACT" : "MARKETING_COMMS";
  const newest = currentStates(inEffect.filter((r) => r.purpose === purposeFor)).sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())[0];
  const legacyWins = marketing === "given" && !!input.marketingConsentAt && (!newest || newest.capturedAt.getTime() < input.marketingConsentAt.getTime());
  const at = legacyWins ? input.marketingConsentAt : (newest?.capturedAt ?? null);

  return {
    marketing,
    consentAtIso: at?.toISOString() ?? null,
    sourceLabel: legacyWins ? "Lead form" : newest?.source ? sourceLabel(newest.source) : null,
    channelLabel: !legacyWins && newest?.channel ? (CHANNEL_LABEL[newest.channel] ?? newest.channel) : null,
    consentText: input.marketingConsentText,
    salesPaused: input.openIssueCount > 0,
    doNotPitch: input.nbaProgramme === "No Action / Do Not Pitch",
  };
}
