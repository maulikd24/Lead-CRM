import { consentDecision, currentStates, type ConsentRow, type ConsentState } from "./decision";
import { CONSENT_POLICY, CONSENT_PURPOSES, DND_PURPOSE, type ConsentPolicy, type PurposeMode } from "./policy";

export type PanelRowInput = ConsentRow & { source: string; noticeVersion: string | null };

export const STATE_LABEL: Record<ConsentState, string> = {
  GRANTED: "Granted",
  WITHDRAWN: "Withdrawn",
  EXPIRED: "Expired",
  UNKNOWN: "Not recorded",
  DO_NOT_CONTACT: "Do not contact",
};

export const MODE_LABEL: Record<PurposeMode, string> = { required: "Opt-in required", default_allow: "Allowed by default", record_only: "Record only" };

export const PURPOSE_LABEL: Record<string, string> = {
  ...Object.fromEntries(CONSENT_PURPOSES.map((p) => [p, CONSENT_POLICY[p].label])),
  [DND_PURPOSE]: "Do not contact",
};

export type PanelRow = {
  purpose: string;
  label: string;
  mode: PurposeMode | null;
  channel: string | null;
  state: ConsentState;
  stateLabel: string;
  source: string | null;
  at: Date | null;
  noticeVersion: string | null;
  /** True when the grant is read from the customer's lead-form timestamp, not from a ledger row. */
  legacy: boolean;
};

/** One row per purpose and channel that has a record; a single "Not recorded" row for a purpose with none. */
export function buildPanelRows(records: readonly PanelRowInput[], legacyMarketingConsentAt: Date | null, now: Date, policy: ConsentPolicy): PanelRow[] {
  const latest = currentStates(records.filter((r) => r.capturedAt.getTime() <= now.getTime()));
  const out: PanelRow[] = [];
  for (const purpose of [...CONSENT_PURPOSES, DND_PURPOSE]) {
    const mode = purpose === DND_PURPOSE ? null : policy[purpose].mode;
    const mine = latest.filter((r) => r.purpose === purpose).sort((a, b) => (a.channel ?? "").localeCompare(b.channel ?? ""));
    for (const r of mine) {
      const expired = r.status === "GRANTED" && !!r.expiresAt && r.expiresAt.getTime() <= now.getTime();
      const state: ConsentState = r.status === "WITHDRAWN" ? "WITHDRAWN" : expired ? "EXPIRED" : purpose === DND_PURPOSE ? "DO_NOT_CONTACT" : "GRANTED";
      out.push({
        purpose, label: PURPOSE_LABEL[purpose], mode, channel: r.channel, state,
        stateLabel: purpose === DND_PURPOSE && state === "WITHDRAWN" ? "Lifted" : STATE_LABEL[state],
        source: r.source, at: r.capturedAt, noticeVersion: r.noticeVersion, legacy: false,
      });
    }
    if (mine.length === 0) {
      const legacy = purpose === "MARKETING_COMMS" && legacyMarketingConsentAt && legacyMarketingConsentAt.getTime() <= now.getTime() ? legacyMarketingConsentAt : null;
      out.push({
        purpose, label: PURPOSE_LABEL[purpose], mode, channel: null,
        state: legacy ? "GRANTED" : "UNKNOWN", stateLabel: legacy ? STATE_LABEL.GRANTED : purpose === DND_PURPOSE ? "Off" : STATE_LABEL.UNKNOWN,
        source: legacy ? "LEAD_FORM" : null, at: legacy, noticeVersion: null, legacy: !!legacy,
      });
    }
  }
  return out;
}

export type ConsentWarning = { kind: "DO_NOT_CONTACT" | "MARKETING_WITHDRAWN"; text: string };

/**
 * The banner above the inbox composer. RMs may still reply to what a customer just asked; this only tells them not to
 * send anything promotional. Null when there is nothing to say. Independent of CONSENT_ENFORCEMENT: it is information.
 */
export function consentWarning(records: readonly ConsentRow[], legacyMarketingConsentAt: Date | null, now: Date): ConsentWarning | null {
  // Judged as if marketing opt-in were required, so a record-only rollout still tells the RM what the customer said.
  const required = { ...CONSENT_POLICY, MARKETING_COMMS: { ...CONSENT_POLICY.MARKETING_COMMS, mode: "required" as const } };
  const decision = consentDecision(records, "MARKETING_COMMS", "whatsapp", now, { legacyMarketingConsentAt, policy: required });
  if (decision.reason === "DO_NOT_CONTACT") {
    return { kind: "DO_NOT_CONTACT", text: "This customer asked not to be contacted. Reply only to something they have just asked you, and send nothing promotional." };
  }
  if (decision.reason === "WITHDRAWN") {
    return { kind: "MARKETING_WITHDRAWN", text: "This customer withdrew consent for marketing messages. You can still reply to their questions, but do not send promotions." };
  }
  return null;
}
