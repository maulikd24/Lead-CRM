/**
 * Consent policy: the one small file compliance edits.
 *
 * Each purpose has a mode:
 *   required       Contact or processing is allowed only with a current GRANTED record (or the legacy lead-form
 *                  timestamp for marketing). No record means no.
 *   default_allow  Allowed unless the customer has explicitly WITHDRAWN. Use for service messages that the
 *                  business may send without opt-in (account, KYC and order notices).
 *   record_only    Never blocks. The decision still reports what would have blocked, so a rollout can be watched
 *                  before it is enforced. A do-not-contact flag still wins (see decision.ts).
 *
 * `honoursDoNotContact` says whether a do-not-contact flag applies to the purpose. It applies to anything that
 * contacts the customer. It does not apply to processing purposes.
 *
 * Owners can switch purposes to record only without a code change: set
 * CONSENT_RECORD_ONLY_PURPOSES to a comma-separated list, for example "MARKETING_COMMS,AI_PROCESSING_OF_CHATS".
 *
 * Enforcement as a whole is off unless CONSENT_ENFORCEMENT=1. This policy is read only when that flag is on.
 */
export const CONSENT_PURPOSES = ["MARKETING_COMMS", "SERVICE_COMMS", "AI_PROCESSING_OF_CHATS", "CALL_RECORDING", "DATA_SHARING_PARTNERS", "ADS_MEASUREMENT"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** A flag, not a purpose of processing: GRANTED means "do not contact" is in force, WITHDRAWN means it was lifted. */
export const DND_PURPOSE = "DO_NOT_CONTACT" as const;
export const LEDGER_PURPOSES = [...CONSENT_PURPOSES, DND_PURPOSE] as const;
export type LedgerPurpose = (typeof LEDGER_PURPOSES)[number];

export const CONSENT_CHANNELS = ["whatsapp", "sms", "email", "call", "push"] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

export const CONSENT_STATUSES = ["GRANTED", "WITHDRAWN"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const CONSENT_SOURCES = ["LEAD_FORM", "APP", "WHATSAPP_KEYWORD", "RM_RECORDED", "IMPORT", "API"] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export type PurposeMode = "required" | "default_allow" | "record_only";
export type PurposePolicy = { mode: PurposeMode; honoursDoNotContact: boolean; label: string; summary: string };

export const CONSENT_POLICY: Record<ConsentPurpose, PurposePolicy> = {
  MARKETING_COMMS: {
    mode: "required",
    honoursDoNotContact: true,
    label: "Marketing messages",
    summary: "Promotional and onboarding nudges by message, email or push. Needs an explicit opt-in.",
  },
  SERVICE_COMMS: {
    mode: "default_allow",
    honoursDoNotContact: true,
    label: "Service messages",
    summary: "Account, KYC and order notices. Allowed without opt-in unless the customer has withdrawn.",
  },
  AI_PROCESSING_OF_CHATS: {
    mode: "required",
    honoursDoNotContact: false,
    label: "AI processing of chats",
    summary: "Letting an assistant read a conversation to suggest a reply. Needs an explicit opt-in.",
  },
  CALL_RECORDING: {
    mode: "required",
    honoursDoNotContact: false,
    label: "Call recording",
    summary: "Recording and reviewing calls. Needs an explicit opt-in.",
  },
  DATA_SHARING_PARTNERS: {
    mode: "required",
    honoursDoNotContact: false,
    label: "Sharing with partners",
    summary: "Sharing profile signals with a processor or partner. Needs an explicit opt-in.",
  },
  ADS_MEASUREMENT: {
    mode: "required",
    honoursDoNotContact: false,
    label: "Ad measurement",
    summary: "Telling advertising platforms, as hashed codes only, that a customer completed KYC or funded, so they can measure which ads work. Needs an explicit opt-in.",
  },
};

/** Default customer-facing wording. Compliance owns the final text: set CONSENT_ADS_MEASUREMENT_NOTICE (and a version) to replace it. */
export const ADS_MEASUREMENT_NOTICE_DEFAULT =
  "We may tell advertising platforms such as Meta and Google, using coded (hashed) identifiers only, that you completed KYC or made a first deposit, so they can measure which ads work. We never share your name, PAN or plain phone number or email. You can withdraw this at any time.";

const MAX_NOTICE = 1000;

/** The wording shown where this consent is recorded, and the version to store with it. Configurable without a code change. */
export function adsMeasurementNotice(env: Record<string, string | undefined> = process.env, approved?: { text: string; version: string } | null): { text: string; version: string | null; source: "default" | "custom" | "approved" } {
  // Wording a second Admin approved in the Approvals inbox (stored by the closed-loop module) wins over the environment and the default.
  if (approved && approved.text.trim()) return { text: approved.text.trim().slice(0, MAX_NOTICE), version: approved.version.trim().slice(0, 60) || null, source: "approved" };
  const custom = (env.CONSENT_ADS_MEASUREMENT_NOTICE ?? "").trim().slice(0, MAX_NOTICE);
  const version = (env.CONSENT_ADS_MEASUREMENT_NOTICE_VERSION ?? "").trim().slice(0, 60) || null;
  return custom ? { text: custom, version, source: "custom" } : { text: ADS_MEASUREMENT_NOTICE_DEFAULT, version, source: "default" };
}

/**
 * The policy the ad-platform outbox judges by: ad measurement is ALWAYS an explicit-opt-in purpose here, whatever the
 * record-only override says. Record only is for watching a rollout; it must never let an identifier leave for a vendor.
 */
export function adsGatePolicy(base: ConsentPolicy): ConsentPolicy {
  return { ...base, ADS_MEASUREMENT: { ...base.ADS_MEASUREMENT, mode: "required" } };
}

export type ConsentPolicy = Record<ConsentPurpose, PurposePolicy>;

/** Applies the CONSENT_RECORD_ONLY_PURPOSES override. Unknown names are ignored. Never mutates `base`. */
export function resolvePolicy(env: Record<string, string | undefined> = process.env, base: ConsentPolicy = CONSENT_POLICY): ConsentPolicy {
  const names = new Set((env.CONSENT_RECORD_ONLY_PURPOSES ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
  const out = {} as ConsentPolicy;
  for (const purpose of CONSENT_PURPOSES) {
    out[purpose] = names.has(purpose) ? { ...base[purpose], mode: "record_only" } : { ...base[purpose] };
  }
  return out;
}

export function isLedgerPurpose(v: unknown): v is LedgerPurpose {
  return typeof v === "string" && (LEDGER_PURPOSES as readonly string[]).includes(v);
}
export function isConsentChannel(v: unknown): v is ConsentChannel {
  return typeof v === "string" && (CONSENT_CHANNELS as readonly string[]).includes(v);
}
