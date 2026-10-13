/**
 * Consent on a Meta Lead Ads form. Same rule as every other lead route: no consent, no lead. A consent checkbox answered yes
 * (or any yes-like value) is consent; anything else, or no consent field at all, is not. Pure: no database, no clock.
 */

const CONSENT_FIELD = /consent|agree|opt[-_ ]?in|permission/i;
const YES = new Set(["yes", "y", "true", "on", "1", "checked", "agree", "i agree", "i consent", "accepted"]);

export function metaConsentGiven(fields: Record<string, string>): boolean {
  return Object.entries(fields).some(([name, value]) => CONSENT_FIELD.test(name) && YES.has(value.trim().toLowerCase()));
}
