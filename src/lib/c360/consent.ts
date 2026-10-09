export type ConsentStatus = { marketing: "given" | "not_recorded"; consentAtIso: string | null; consentText: string | null; salesPaused: boolean; doNotPitch: boolean };

/** Consent and contact-restriction state, derived only from fields that exist: no invented opt-out flag. */
export function buildConsentStatus(input: { marketingConsentAt: Date | null; marketingConsentText: string | null; openIssueCount: number; nbaProgramme: string | null }): ConsentStatus {
  return {
    marketing: input.marketingConsentAt ? "given" : "not_recorded",
    consentAtIso: input.marketingConsentAt?.toISOString() ?? null,
    consentText: input.marketingConsentText,
    salesPaused: input.openIssueCount > 0,
    doNotPitch: input.nbaProgramme === "No Action / Do Not Pitch",
  };
}
